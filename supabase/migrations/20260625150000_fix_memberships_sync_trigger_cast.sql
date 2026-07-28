-- ============================================================
-- 버그픽스: memberships_sync_trigger — members.status enum 캐스팅
-- ------------------------------------------------------------
-- active → paused/expired/canceled 전환 시 members.status 를
-- CASE(text) 로 대입해 "column status is of type member_status but
-- expression is of type text" 에러 → 홀딩·만료·환불(권한차단) 전부 실패.
-- ('active'/'unpaid' 단일 리터럴은 통과, CASE 식만 text 타입이라 실패)
-- → CASE 결과를 ::member_status 로 캐스팅. 그 외 로직 불변.
-- ============================================================
CREATE OR REPLACE FUNCTION public.memberships_sync_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status = 'active' AND NEW.payment_status IN ('paid', 'partial') THEN
    PERFORM public.enqueue_member_sync(NEW.member_id, 'update_user');
    UPDATE members SET status = 'active'
      WHERE id = NEW.member_id AND status NOT IN ('suspended', 'withdrawn');
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'active' AND NEW.status IN ('expired', 'paused', 'canceled') THEN
      PERFORM public.enqueue_member_sync(NEW.member_id, 'disable_user');
      IF NOT EXISTS (
        SELECT 1 FROM memberships
         WHERE member_id = NEW.member_id
           AND id <> NEW.id
           AND status = 'active'
           AND payment_status IN ('paid', 'partial')
      ) THEN
        UPDATE members SET status = (CASE
          WHEN NEW.status = 'paused' THEN 'suspended'
          ELSE 'expired'
        END)::member_status
        WHERE id = NEW.member_id AND status NOT IN ('suspended', 'withdrawn');
      END IF;
      RETURN NEW;
    END IF;
    IF OLD.payment_status IN ('paid', 'partial') AND NEW.payment_status = 'unpaid' THEN
      PERFORM public.enqueue_member_sync(NEW.member_id, 'disable_user');
      UPDATE members SET status = 'unpaid'
        WHERE id = NEW.member_id AND status = 'active';
      RETURN NEW;
    END IF;
    IF OLD.payment_status = 'unpaid'
       AND NEW.payment_status IN ('paid', 'partial')
       AND NEW.status = 'active' THEN
      PERFORM public.enqueue_member_sync(NEW.member_id, 'update_user');
      UPDATE members SET status = 'active'
        WHERE id = NEW.member_id AND status = 'unpaid';
      RETURN NEW;
    END IF;
  END IF;

  RETURN NEW;
END $$;
