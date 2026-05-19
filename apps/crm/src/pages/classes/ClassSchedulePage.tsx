/**
 * 수업 일정표 — 주간 캘린더 뷰
 * 코치별 수업, 예약 현황, 출석 체크
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays, ChevronLeft, ChevronRight, Plus, Users,
  CheckCircle2, Clock, X, Building2, ArrowLeft,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Dialog } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/AuthContext";
import { getBranchesWithStats } from "@/services/branches";
import {
  listClasses, listSessions, createSession, updateSessionStatus,
  createBooking, updateBookingStatus,
  CLASS_TYPE_LABELS, SESSION_STATUS_LABELS, BOOKING_STATUS_LABELS,
  type ClassSession, type SessionStatus, type BookingStatus,
} from "@/services/classes";
import { listMembers } from "@/services/members";
import { cn } from "@/lib/cn";

const DAY_LABELS = ["월", "화", "수", "목", "금", "토", "일"];
const STATUS_COLORS: Record<SessionStatus, string> = {
  scheduled: "border-blue-200 bg-blue-50",
  in_progress: "border-green-200 bg-green-50",
  completed: "border-muted bg-muted/40",
  canceled: "border-red-200 bg-red-50 opacity-60",
};

function getWeekDates(baseDate: Date) {
  const day = baseDate.getDay();
  const monday = new Date(baseDate);
  monday.setDate(baseDate.getDate() - (day === 0 ? 6 : day - 1));
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
}

function fmt(d: Date) {
  return d.toISOString().slice(0, 10);
}

export default function ClassSchedulePage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const profileBranchId = profile?.branch_id ?? "";
  const isHqUser = !profileBranchId;
  const [selectedBranchId, setSelectedBranchId] = useState("");
  const branchId = isHqUser ? selectedBranchId : profileBranchId;

  const [baseDate, setBaseDate] = useState(new Date());
  const weekDates = getWeekDates(baseDate);
  const weekLabel = `${fmt(weekDates[0])} ~ ${fmt(weekDates[6])}`;

  // 세션 추가 다이얼로그
  const [showAddSession, setShowAddSession] = useState(false);
  const [sessionForm, setSessionForm] = useState({
    class_id: "", session_date: fmt(new Date()),
    start_time: "10:00", end_time: "11:00", coach_id: "",
  });

  // 세션 상세 (출석 체크)
  const [selectedSession, setSelectedSession] = useState<ClassSession | null>(null);
  const [showAddBooking, setShowAddBooking] = useState(false);
  const [bookingMemberId, setBookingMemberId] = useState("");

  const { data: branches = [] } = useQuery({
    queryKey: ["branches-list"],
    queryFn: getBranchesWithStats,
    enabled: isHqUser,
  });

  const { data: sessions = [], isLoading } = useQuery({
    queryKey: ["class-sessions", branchId, fmt(weekDates[0])],
    queryFn: () => listSessions(branchId, fmt(weekDates[0]), true),
    enabled: !!branchId,
  });

  const { data: classes = [] } = useQuery({
    queryKey: ["classes", branchId],
    queryFn: () => listClasses(branchId),
    enabled: !!branchId,
  });

  const { data: members = [] } = useQuery({
    queryKey: ["members", branchId],
    queryFn: () => listMembers({ branchId }),
    enabled: !!branchId && showAddBooking,
  });

  const addSessionMutation = useMutation({
    mutationFn: () => createSession(branchId, {
      ...sessionForm,
      coach_id: sessionForm.coach_id || null,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["class-sessions", branchId] });
      setShowAddSession(false);
      setSessionForm({ class_id: "", session_date: fmt(new Date()), start_time: "10:00", end_time: "11:00", coach_id: "" });
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ sessionId, status }: { sessionId: string; status: SessionStatus }) =>
      updateSessionStatus(sessionId, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["class-sessions", branchId] }),
  });

  const bookingMutation = useMutation({
    mutationFn: () => createBooking(selectedSession!.id, bookingMemberId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["class-sessions", branchId] });
      setShowAddBooking(false);
      setBookingMemberId("");
    },
  });

  const attendanceMutation = useMutation({
    mutationFn: ({ bookingId, status }: { bookingId: string; status: BookingStatus }) =>
      updateBookingStatus(bookingId, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["class-sessions", branchId] }),
  });

  // 날짜별 세션 그룹핑
  const sessionsByDate = weekDates.reduce<Record<string, ClassSession[]>>((acc, d) => {
    acc[fmt(d)] = sessions.filter(s => s.session_date === fmt(d));
    return acc;
  }, {});

  const prevWeek = () => { const d = new Date(baseDate); d.setDate(d.getDate() - 7); setBaseDate(d); };
  const nextWeek = () => { const d = new Date(baseDate); d.setDate(d.getDate() + 7); setBaseDate(d); };

  return (
    <div className="flex-1 overflow-y-auto bg-muted/30">
      <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">

        {/* 헤더 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="gap-1.5 text-muted-foreground hover:text-foreground">
              <ArrowLeft className="size-4" />뒤로
            </Button>
            <div className="flex size-9 items-center justify-center rounded-lg bg-brand/10">
              <CalendarDays className="size-5 text-brand" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-foreground">수업 일정표</h1>
              <p className="text-xs text-muted-foreground">주간 수업 / 예약 / 출석 관리</p>
            </div>
          </div>
          <Button onClick={() => setShowAddSession(true)} disabled={!branchId} className="gap-2">
            <Plus className="size-4" /> 수업 추가
          </Button>
        </div>

        {/* 본사 지점 선택 */}
        {isHqUser && (
          <Card className="px-4 py-3 flex items-center gap-3">
            <Building2 className="size-4 text-muted-foreground shrink-0" />
            <Select value={selectedBranchId} onChange={e => setSelectedBranchId(e.target.value)} className="h-8 text-sm">
              <option value="">지점을 선택하세요</option>
              {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          </Card>
        )}

        {!branchId ? (
          <Card className="py-20 flex flex-col items-center gap-3 text-muted-foreground">
            <CalendarDays className="size-10 opacity-30" />
            <p className="text-sm">지점을 선택하면 수업 일정이 표시됩니다</p>
          </Card>
        ) : (
          <>
            {/* 주간 네비게이션 */}
            <div className="flex items-center gap-3">
              <Button variant="outline" size="sm" onClick={prevWeek}><ChevronLeft className="size-4" /></Button>
              <span className="text-sm font-medium text-foreground flex-1 text-center">{weekLabel}</span>
              <Button variant="outline" size="sm" onClick={nextWeek}><ChevronRight className="size-4" /></Button>
            </div>

            {/* 주간 캘린더 */}
            {isLoading ? (
              <div className="text-center py-16 text-muted-foreground text-sm">불러오는 중…</div>
            ) : (
              <div className="grid grid-cols-7 gap-2">
                {weekDates.map((d, i) => {
                  const dateStr = fmt(d);
                  const daySessions = sessionsByDate[dateStr] ?? [];
                  const isToday = dateStr === fmt(new Date());
                  return (
                    <div key={dateStr} className="space-y-1.5">
                      {/* 요일 헤더 */}
                      <div className={cn("text-center py-1.5 rounded-lg text-xs font-semibold",
                        isToday ? "bg-brand text-white" : "bg-muted text-muted-foreground")}>
                        <div>{DAY_LABELS[i]}</div>
                        <div className="text-[10px] opacity-70">{d.getMonth() + 1}/{d.getDate()}</div>
                      </div>

                      {/* 세션 목록 */}
                      {daySessions.length === 0 ? (
                        <div className="h-16 rounded-lg border border-dashed border-border flex items-center justify-center">
                          <span className="text-[10px] text-muted-foreground">없음</span>
                        </div>
                      ) : (
                        daySessions.map(s => {
                          const bookings = s.class_bookings ?? [];
                          const attended = bookings.filter(b => b.status === "attended").length;
                          return (
                            <button key={s.id}
                              onClick={() => setSelectedSession(s)}
                              className={cn("w-full text-left p-2 rounded-lg border transition-colors hover:shadow-sm",
                                STATUS_COLORS[s.status])}>
                              <div className="text-[10px] font-bold text-foreground truncate">
                                {s.classes?.name ?? "수업"}
                              </div>
                              <div className="text-[9px] text-muted-foreground">{s.start_time.slice(0, 5)}</div>
                              <div className="flex items-center gap-1 mt-1">
                                <Users className="size-2.5 text-muted-foreground" />
                                <span className="text-[9px] text-muted-foreground">
                                  {attended}/{bookings.length}/{s.capacity}
                                </span>
                              </div>
                            </button>
                          );
                        })
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* 세션 추가 다이얼로그 */}
      <Dialog open={showAddSession} onClose={() => setShowAddSession(false)} title="수업 추가" className="max-w-md">
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>수업 종류 *</Label>
            <Select value={sessionForm.class_id} onChange={e => setSessionForm(f => ({ ...f, class_id: e.target.value }))}>
              <option value="">수업을 선택하세요</option>
              {classes.filter(c => c.is_active).map(c => (
                <option key={c.id} value={c.id}>{c.name} ({CLASS_TYPE_LABELS[c.class_type]})</option>
              ))}
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>날짜 *</Label>
              <Input type="date" value={sessionForm.session_date}
                onChange={e => setSessionForm(f => ({ ...f, session_date: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>시작 시간 *</Label>
              <Input type="time" value={sessionForm.start_time}
                onChange={e => setSessionForm(f => ({ ...f, start_time: e.target.value }))} />
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label>종료 시간 *</Label>
              <Input type="time" value={sessionForm.end_time}
                onChange={e => setSessionForm(f => ({ ...f, end_time: e.target.value }))} />
            </div>
          </div>
          {addSessionMutation.error && (
            <p className="text-sm text-danger">{(addSessionMutation.error as Error).message}</p>
          )}
          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <Button variant="outline" onClick={() => setShowAddSession(false)}>취소</Button>
            <Button onClick={() => addSessionMutation.mutate()}
              disabled={!sessionForm.class_id || !sessionForm.session_date || addSessionMutation.isPending}>
              {addSessionMutation.isPending ? "추가 중…" : "추가"}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* 세션 상세 / 출석 체크 */}
      {selectedSession && (
        <Dialog open={!!selectedSession} onClose={() => setSelectedSession(null)}
          title={`${selectedSession.classes?.name ?? "수업"} — ${selectedSession.session_date} ${selectedSession.start_time.slice(0, 5)}`}
          className="max-w-lg">
          <div className="space-y-4">
            {/* 세션 상태 변경 */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-muted-foreground">상태:</span>
              {(["scheduled", "in_progress", "completed", "canceled"] as SessionStatus[]).map(st => (
                <button key={st}
                  onClick={() => statusMutation.mutate({ sessionId: selectedSession.id, status: st })}
                  className={cn("text-xs px-2 py-0.5 rounded-full font-medium transition-colors",
                    selectedSession.status === st
                      ? "bg-brand text-white"
                      : "bg-muted text-muted-foreground hover:bg-muted/70")}>
                  {SESSION_STATUS_LABELS[st]}
                </button>
              ))}
            </div>

            {/* 예약 목록 */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-foreground">
                  예약 ({(selectedSession.class_bookings ?? []).length}/{selectedSession.capacity})
                </span>
                <Button size="sm" variant="outline" onClick={() => setShowAddBooking(true)}>
                  <Plus className="size-3.5 mr-1" /> 회원 추가
                </Button>
              </div>

              {(selectedSession.class_bookings ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">예약된 회원이 없습니다</p>
              ) : (
                <div className="space-y-1.5">
                  {(selectedSession.class_bookings ?? []).map(b => (
                    <div key={b.id} className="flex items-center gap-3 px-3 py-2 bg-muted/30 rounded-lg">
                      <div className="size-7 rounded-full bg-brand/10 flex items-center justify-center shrink-0">
                        <span className="text-xs font-bold text-brand">
                          {(b.members?.name ?? "?").slice(0, 1)}
                        </span>
                      </div>
                      <span className="text-sm font-medium text-foreground flex-1">{b.members?.name ?? "회원"}</span>
                      <div className="flex gap-1">
                        {(["attended", "no_show", "canceled"] as BookingStatus[]).map(st => (
                          <button key={st}
                            onClick={() => attendanceMutation.mutate({ bookingId: b.id, status: st })}
                            className={cn("text-[10px] px-1.5 py-0.5 rounded font-medium transition-colors",
                              b.status === st
                                ? st === "attended" ? "bg-success text-white"
                                  : st === "no_show" ? "bg-warning text-white"
                                  : "bg-danger text-white"
                                : "bg-muted text-muted-foreground")}>
                            {BOOKING_STATUS_LABELS[st]}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 회원 추가 */}
            {showAddBooking && (
              <div className="space-y-2 p-3 bg-muted/30 rounded-lg">
                <Label>예약 회원 선택</Label>
                <Select value={bookingMemberId} onChange={e => setBookingMemberId(e.target.value)}>
                  <option value="">회원을 선택하세요</option>
                  {members.filter(m => !(selectedSession.class_bookings ?? []).some(b => b.member_id === m.id))
                    .map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </Select>
                {bookingMutation.error && (
                  <p className="text-xs text-danger">{(bookingMutation.error as Error).message}</p>
                )}
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setShowAddBooking(false)}>취소</Button>
                  <Button size="sm" onClick={() => bookingMutation.mutate()}
                    disabled={!bookingMemberId || bookingMutation.isPending}>
                    {bookingMutation.isPending ? "추가 중…" : "예약 추가"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </Dialog>
      )}
    </div>
  );
}
