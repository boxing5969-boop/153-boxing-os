import { type FormEvent, useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import { roleLabel } from "@/lib/roleLabels";
import { updateOwnProfile } from "@/services/profileApi";
import { supabase } from "@/integrations/supabase/client";

export default function ProfilePage() {
  const { user, profile, refreshProfile } = useAuth();
  const [name, setName] = useState(profile?.name ?? "");
  const [phone, setPhone] = useState(profile?.phone ?? "");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // 비밀번호 변경
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSuccess, setPwSuccess] = useState(false);
  const [pwLoading, setPwLoading] = useState(false);

  useEffect(() => {
    if (profile) {
      setName(profile.name);
      setPhone(profile.phone ?? "");
    }
  }, [profile]);

  const mutation = useMutation({
    mutationFn: updateOwnProfile,
    onSuccess: async () => {
      setSuccess(true);
      setError(null);
      await refreshProfile();
    },
    onError: (err) => {
      setSuccess(false);
      setError(err instanceof Error ? err.message : "저장 실패");
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSuccess(false);
    mutation.mutate({ name: name.trim(), phone: phone.trim() || null });
  }

  async function handlePasswordChange(e: FormEvent) {
    e.preventDefault();
    setPwError(null);
    setPwSuccess(false);
    if (newPw.length < 8) {
      setPwError("비밀번호는 8자 이상으로 설정해 주세요.");
      return;
    }
    if (newPw !== confirmPw) {
      setPwError("새 비밀번호가 일치하지 않습니다.");
      return;
    }
    setPwLoading(true);
    const { error: upErr } = await supabase.auth.updateUser({ password: newPw });
    setPwLoading(false);
    if (upErr) {
      setPwError(upErr.message);
      return;
    }
    setPwSuccess(true);
    setNewPw("");
    setConfirmPw("");
  }

  return (
    <div className="space-y-6 max-w-xl">
      <PageHeader title="설정" description="자기 프로필" />

      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold opacity-80">계정 정보 (변경 불가)</h2>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-3 gap-y-2 text-sm">
            <dt className="opacity-60">이메일</dt>
            <dd className="col-span-2">{user?.email ?? "—"}</dd>
            <dt className="opacity-60">역할</dt>
            <dd className="col-span-2">{roleLabel(profile?.role)}</dd>
            <dt className="opacity-60">소속 지점</dt>
            <dd className="col-span-2 opacity-80">{profile?.branch_id ?? "—"}</dd>
            <dt className="opacity-60">가입일</dt>
            <dd className="col-span-2 opacity-80">{profile?.created_at?.slice(0, 10) ?? "—"}</dd>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold opacity-80">개인 정보 수정</h2>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="pname">이름 *</Label>
              <Input
                id="pname"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pphone">전화번호</Label>
              <Input
                id="pphone"
                type="tel"
                placeholder="010-1234-5678"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
            {error && (
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
            )}
            {success && (
              <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">
                저장되었습니다.
              </p>
            )}
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "저장 중…" : "저장"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold opacity-80">비밀번호 변경</h2>
        </CardHeader>
        <CardContent>
          <form onSubmit={handlePasswordChange} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="newpw">새 비밀번호 (8자 이상)</Label>
              <Input
                id="newpw"
                type="password"
                autoComplete="new-password"
                required
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmpw">새 비밀번호 확인</Label>
              <Input
                id="confirmpw"
                type="password"
                autoComplete="new-password"
                required
                value={confirmPw}
                onChange={(e) => setConfirmPw(e.target.value)}
              />
            </div>
            {pwError && (
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{pwError}</p>
            )}
            {pwSuccess && (
              <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">
                비밀번호가 변경되었습니다. 다음 로그인부터 새 비밀번호를 사용하세요.
              </p>
            )}
            <Button type="submit" disabled={pwLoading}>
              {pwLoading ? "변경 중…" : "비밀번호 변경"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
