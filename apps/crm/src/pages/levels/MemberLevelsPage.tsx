import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import MemberStatusBadge from "@/components/members/MemberStatusBadge";
import { LevelProgressGrid } from "@/components/levels/LevelProgressGrid";
import { getMember } from "@/services/members";
import { listMemberLevels } from "@/services/levels";
import { useAuth } from "@/contexts/AuthContext";

export default function MemberLevelsPage() {
  const { id } = useParams<{ id: string }>();
  const memberId = id ?? "";
  const { profile } = useAuth();

  const memberQuery = useQuery({
    queryKey: ["member", memberId],
    queryFn: () => getMember(memberId),
    enabled: !!memberId,
  });

  const levelsQuery = useQuery({
    queryKey: ["levels", memberId],
    queryFn: () => listMemberLevels(memberId),
    enabled: !!memberId,
  });

  if (memberQuery.isLoading) {
    return <p className="text-sm text-muted-foreground">로딩 중…</p>;
  }
  if (!memberQuery.data) {
    return (
      <PageHeader
        title="회원을 찾을 수 없습니다"
        action={
          <Link to="/levels">
            <Button variant="outline" className="gap-1.5 rounded-full">
              <ArrowLeft className="size-4" />
              목록으로
            </Button>
          </Link>
        }
      />
    );
  }

  const member = memberQuery.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${member.name} — 레벨`}
        description={
          <span className="flex items-center gap-2">
            <MemberStatusBadge status={member.status} />
            <span className="text-muted-foreground">셀을 변경하면 즉시 저장됩니다.</span>
          </span>
        }
        action={
          <Link to="/levels">
            <Button variant="outline" className="gap-1.5 rounded-full">
              <ArrowLeft className="size-4" />
              목록으로
            </Button>
          </Link>
        }
      />

      <Card className="rounded-2xl">
        <CardHeader>
          <h2 className="text-sm font-semibold text-foreground">진행 그리드 (4 티어 × 10 레벨)</h2>
        </CardHeader>
        <CardContent>
          <LevelProgressGrid
            memberId={member.id}
            rows={levelsQuery.data ?? []}
            approvedBy={profile?.id ?? null}
          />
        </CardContent>
      </Card>
    </div>
  );
}
