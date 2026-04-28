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

export default function ProfilePage() {
  const { user, profile, refreshProfile } = useAuth();
  const [name, setName] = useState(profile?.name ?? "");
  const [phone, setPhone] = useState(profile?.phone ?? "");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

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
    </div>
  );
}
