import { getChatGPTUser } from "./chatgpt-auth";
import CouncilWorkspace from "./council-workspace";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getChatGPTUser();

  return (
    <CouncilWorkspace
      displayName={user?.fullName ?? user?.email?.split("@")[0] ?? "Builder"}
    />
  );
}
