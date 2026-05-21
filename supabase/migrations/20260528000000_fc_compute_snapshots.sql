-- ============================================================
-- FC AI Care Center 2차-①: 회원 분석 엔진
-- ============================================================
-- compute_member_snapshots(branch?) : 회원별로
--   출석 리듬 · 생애주기 · 행동 분류 · 이탈/재등록/PT/추천 점수를 계산해
--   member_status_snapshots(일별) 와 member_segments(auto) 에 적재한다.
-- 회원 단위 예외 격리 — 한 회원 계산 실패가 전체 배치를 막지 않음.
-- ============================================================

CREATE OR REPLACE FUNCTION public.compute_member_snapshots(p_branch_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_today      date := (now() AT TIME ZONE 'Asia/Seoul')::date;
  v_count      int := 0;
  m            record;
  v_ms         public.memberships%ROWTYPE;
  v_last       timestamptz;
  v_days_since int;
  v_v56        int;
  v_v30        int;
  v_vmonth     int;
  v_weekly     numeric;
  v_age        int;
  v_expiry     date;
  v_dexp       int;
  v_pt         int;
  v_sat        numeric;
  v_product    text;
  v_lifecycle  text;
  v_rhythm     text;
  v_behavior   text;
  v_churn      numeric;
  v_renew      numeric;
  v_ptscore    numeric;
  v_referral   numeric;
  v_pay        text;
  v_trial      boolean;
  v_segs       text[];
  seg          text;
BEGIN
  FOR m IN
    SELECT id, branch_id, company_id, brand_id, created_at, status
    FROM public.members
    WHERE deleted_at IS NULL AND status <> 'withdrawn'
      AND (p_branch_id IS NULL OR branch_id = p_branch_id)
  LOOP
    BEGIN
      -- 출석 집계
      SELECT max(occurred_at) INTO v_last
      FROM public.access_logs WHERE member_id = m.id AND result = 'success';
      v_days_since := CASE WHEN v_last IS NULL THEN NULL
        ELSE v_today - (v_last AT TIME ZONE 'Asia/Seoul')::date END;
      SELECT count(DISTINCT (occurred_at AT TIME ZONE 'Asia/Seoul')::date) INTO v_v56
      FROM public.access_logs WHERE member_id=m.id AND result='success'
        AND occurred_at >= now() - interval '56 days';
      SELECT count(DISTINCT (occurred_at AT TIME ZONE 'Asia/Seoul')::date) INTO v_v30
      FROM public.access_logs WHERE member_id=m.id AND result='success'
        AND occurred_at >= now() - interval '30 days';
      SELECT count(DISTINCT (occurred_at AT TIME ZONE 'Asia/Seoul')::date) INTO v_vmonth
      FROM public.access_logs WHERE member_id=m.id AND result='success'
        AND (occurred_at AT TIME ZONE 'Asia/Seoul')::date >= date_trunc('month', v_today)::date;
      v_weekly := round(COALESCE(v_v56,0) / 8.0, 2);
      v_age := v_today - (m.created_at AT TIME ZONE 'Asia/Seoul')::date;

      -- 최신 멤버십
      SELECT * INTO v_ms FROM public.memberships
      WHERE member_id = m.id AND deleted_at IS NULL
      ORDER BY end_date DESC NULLS LAST LIMIT 1;
      v_expiry := v_ms.end_date;
      v_dexp := CASE WHEN v_expiry IS NULL THEN NULL ELSE v_expiry - v_today END;
      v_pay := COALESCE(v_ms.payment_status::text, 'unknown');

      SELECT EXISTS(SELECT 1 FROM public.trial_passes
                    WHERE member_id=m.id AND status='active') INTO v_trial;
      -- PT 잔여 회차 = 회차제 멤버십(max_sessions 보유)의 남은 회차 합계
      SELECT COALESCE(sum(GREATEST(COALESCE(max_sessions,0)-COALESCE(used_sessions,0),0)),0)
        INTO v_pt
      FROM public.memberships
      WHERE member_id=m.id AND max_sessions IS NOT NULL
        AND status='active' AND deleted_at IS NULL;

      SELECT round(avg(s.score),2) INTO v_sat
      FROM public.survey_response_scores s
      JOIN public.survey_responses r ON r.id = s.response_id
      WHERE r.member_id = m.id AND s.metric='overall'
        AND r.submitted_at >= now() - interval '180 days';

      -- 상품 분류 (memberships 에 plan_type 없음 → max_sessions·plan_name 기반)
      v_product := CASE
        WHEN v_trial THEN 'trial'
        WHEN v_ms.max_sessions IS NOT NULL
             OR v_ms.plan_name ILIKE '%PT%' OR v_ms.plan_name ILIKE '%개인%' THEN 'pt'
        WHEN v_ms.plan_name ILIKE '%복싱%' OR v_ms.plan_name ILIKE '%boxing%' THEN 'boxing'
        WHEN v_ms.plan_name ILIKE '%스피닝%' OR v_ms.plan_name ILIKE '%spin%' THEN 'spinning'
        WHEN v_ms.plan_name ILIKE '%그룹%' OR v_ms.plan_name ILIKE '%group%'
             OR v_ms.plan_name ILIKE '%수업%' THEN 'group_class'
        ELSE 'gym' END;

      -- 생애주기
      v_lifecycle := CASE
        WHEN v_ms.id IS NULL OR v_ms.status='expired'
             OR (v_expiry IS NOT NULL AND v_expiry < v_today) THEN 'expired'
        WHEN v_age <= 7  THEN 'new_0_7_days'
        WHEN v_age <= 30 THEN 'new_8_30_days'
        WHEN v_dexp IS NOT NULL AND v_dexp BETWEEN 0 AND 7  THEN 'renewal_d7'
        WHEN v_dexp IS NOT NULL AND v_dexp BETWEEN 0 AND 14 THEN 'renewal_d14'
        WHEN v_dexp IS NOT NULL AND v_dexp BETWEEN 0 AND 30 THEN 'renewal_d30'
        WHEN v_days_since IS NULL OR v_days_since > 30 THEN 'dormant'
        WHEN v_days_since > 14 THEN 'attendance_risk'
        WHEN v_age <= 90 THEN 'habit_building'
        ELSE 'active' END;

      -- 출석 리듬 (평소 패턴 대비)
      v_rhythm := CASE
        WHEN v_days_since IS NULL OR v_days_since > 21 THEN 'dormant'
        WHEN v_weekly >= 0.5 AND v_days_since > (7.0/v_weekly)*2.5 THEN 'at_risk'
        WHEN v_age <= 7 AND COALESCE(v_v56,0) < 2 THEN 'at_risk'
        WHEN v_weekly >= 0.5 AND v_days_since > (7.0/v_weekly)*1.5 THEN 'slowing'
        ELSE 'normal' END;

      -- 점수 (0~100)
      v_churn := LEAST(100, GREATEST(0,
          COALESCE(v_days_since,30) * 2
        + CASE v_rhythm WHEN 'at_risk' THEN 30 WHEN 'slowing' THEN 15
                        WHEN 'dormant' THEN 40 ELSE 0 END
        + CASE WHEN v_pay='unpaid' THEN 20 ELSE 0 END
        + CASE WHEN v_sat IS NOT NULL AND v_sat <= 3 THEN 15 ELSE 0 END));
      v_renew := CASE WHEN v_dexp IS NOT NULL AND v_dexp BETWEEN 0 AND 30
                      THEN LEAST(100, 50 + COALESCE(v_v30,0)*5) ELSE 0 END;
      v_ptscore := CASE
        WHEN v_product <> 'pt' AND COALESCE(v_v30,0) >= 8 THEN 70
        WHEN v_product <> 'pt' AND COALESCE(v_v30,0) >= 4 THEN 40 ELSE 0 END;
      v_referral := CASE
        WHEN COALESCE(v_v30,0) >= 8 AND COALESCE(v_sat,0) >= 4.5 AND v_pay <> 'unpaid' THEN 80
        WHEN COALESCE(v_v30,0) >= 6 AND COALESCE(v_sat,5) >= 4 THEN 50 ELSE 0 END;

      -- 대표 행동 세그먼트
      v_behavior := CASE
        WHEN v_pay='unpaid' THEN 'unpaid'
        WHEN v_rhythm='at_risk' THEN 'sudden_absence'
        WHEN v_ptscore >= 70 THEN 'pt_candidate'
        WHEN v_renew >= 60 THEN 'renewal_candidate'
        WHEN COALESCE(v_v30,0) >= 8 AND COALESCE(v_sat,5) >= 4.5 THEN 'vip'
        WHEN v_referral >= 80 THEN 'referral_candidate'
        WHEN COALESCE(v_v30,0) >= 8 THEN 'consistent_attendee'
        WHEN v_sat IS NOT NULL AND v_sat <= 3 THEN 'low_satisfaction'
        ELSE NULL END;

      -- 스냅샷 upsert
      INSERT INTO public.member_status_snapshots
        (company_id, brand_id, branch_id, member_id, snapshot_date,
         product_type, lifecycle_stage, behavior_segment, last_visit_at, days_since_last_visit,
         usual_visit_frequency, attendance_rhythm_status, membership_expiry_date, days_until_expiry,
         payment_status, pt_remaining_sessions, satisfaction_score,
         churn_risk_score, renewal_opportunity_score, pt_conversion_score, referral_potential_score)
      VALUES
        (m.company_id, m.brand_id, m.branch_id, m.id, v_today,
         v_product, v_lifecycle, v_behavior, v_last, v_days_since,
         v_weekly, v_rhythm, v_expiry, v_dexp,
         v_pay, v_pt, v_sat, v_churn, v_renew, v_ptscore, v_referral)
      ON CONFLICT (member_id, snapshot_date) DO UPDATE SET
        product_type=EXCLUDED.product_type, lifecycle_stage=EXCLUDED.lifecycle_stage,
        behavior_segment=EXCLUDED.behavior_segment, last_visit_at=EXCLUDED.last_visit_at,
        days_since_last_visit=EXCLUDED.days_since_last_visit,
        usual_visit_frequency=EXCLUDED.usual_visit_frequency,
        attendance_rhythm_status=EXCLUDED.attendance_rhythm_status,
        membership_expiry_date=EXCLUDED.membership_expiry_date,
        days_until_expiry=EXCLUDED.days_until_expiry, payment_status=EXCLUDED.payment_status,
        pt_remaining_sessions=EXCLUDED.pt_remaining_sessions, satisfaction_score=EXCLUDED.satisfaction_score,
        churn_risk_score=EXCLUDED.churn_risk_score, renewal_opportunity_score=EXCLUDED.renewal_opportunity_score,
        pt_conversion_score=EXCLUDED.pt_conversion_score, referral_potential_score=EXCLUDED.referral_potential_score;

      -- 자동 세그먼트 재계산
      -- 세그먼트 누적: 텍스트 리터럴은 array_append 사용
      -- (text[] || unknown 리터럴은 배열 리터럴로 오인되어 실패함)
      v_segs := ARRAY[v_product || '_member'];
      IF v_days_since IS NOT NULL AND v_days_since >= 15 AND v_lifecycle <> 'expired'
        THEN v_segs := array_append(v_segs, '15_days_absent'); END IF;
      IF COALESCE(v_vmonth,0) >= 10 AND COALESCE(v_sat,5) >= 4.5 AND v_pay <> 'unpaid'
        THEN v_segs := array_append(v_segs, 'consistent_attendee'); END IF;
      IF v_pt BETWEEN 1 AND 3 AND COALESCE(v_v30,0) >= 4
        THEN v_segs := array_append(v_segs, 'pt_conversion_candidate'); END IF;
      IF v_dexp IS NOT NULL AND v_dexp BETWEEN 0 AND 7  THEN v_segs := array_append(v_segs, 'renewal_d7');
      ELSIF v_dexp IS NOT NULL AND v_dexp BETWEEN 0 AND 14 THEN v_segs := array_append(v_segs, 'renewal_d14');
      ELSIF v_dexp IS NOT NULL AND v_dexp BETWEEN 0 AND 30 THEN v_segs := array_append(v_segs, 'renewal_d30');
      END IF;
      IF v_churn >= 60 THEN v_segs := array_append(v_segs, 'high_churn_risk'); END IF;
      IF v_pay = 'unpaid' THEN v_segs := array_append(v_segs, 'unpaid_member'); END IF;
      IF v_referral >= 80 THEN v_segs := array_append(v_segs, 'referral_candidate'); END IF;
      IF v_behavior = 'vip' THEN v_segs := array_append(v_segs, 'vip'); END IF;

      DELETE FROM public.member_segments WHERE member_id = m.id AND source = 'auto';
      FOREACH seg IN ARRAY v_segs LOOP
        INSERT INTO public.member_segments (branch_id, member_id, segment_key, source)
        VALUES (m.branch_id, m.id, seg, 'auto')
        ON CONFLICT (member_id, segment_key) DO NOTHING;
      END LOOP;

      v_count := v_count + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'compute_member_snapshots: member % 실패 — %', m.id, SQLERRM;
    END;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'date', v_today, 'members_processed', v_count);
END $$;

-- 데이터를 쓰는 배치 함수 — 익명(anon)·PUBLIC 실행 차단
REVOKE EXECUTE ON FUNCTION public.compute_member_snapshots(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.compute_member_snapshots(uuid) TO authenticated, service_role;
