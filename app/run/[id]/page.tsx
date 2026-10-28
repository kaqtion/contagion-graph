import Console from "@/components/Console";

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Console runId={id} />;
}
