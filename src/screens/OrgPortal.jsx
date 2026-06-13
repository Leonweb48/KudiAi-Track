import { supabase } from "../utils/supabase";
import CoopDashboard from "./CoopDashboard";

export default function OrgPortal({ org, session }) {
  return (
    <CoopDashboard
      org={org}
      onBack={() => supabase.auth.signOut()}
      isOrgPortal={true}
    />
  );
}
