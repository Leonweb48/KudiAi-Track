import { useState, useEffect, useCallback } from "react";
import { supabase } from "../utils/supabase";

export function useConsent(userId) {
  const [state, setState] = useState({
    needsConsent:  false,
    isReConsent:   false,
    tncVersion:    null,
    privacyVersion: null,
    changeSummary: null,
    loading:       true,
  });

  const check = useCallback(async () => {
    if (!userId) {
      setState({ needsConsent: false, isReConsent: false, tncVersion: null, privacyVersion: null, changeSummary: null, loading: false });
      return;
    }

    // Fetch latest published tnc document
    const { data: tncDoc } = await supabase
      .from("legal_documents")
      .select("id, version, requires_reacceptance, change_summary")
      .eq("type", "tnc")
      .eq("status", "published")
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Fetch latest published privacy document
    const { data: privacyDoc } = await supabase
      .from("legal_documents")
      .select("id, version, requires_reacceptance, change_summary")
      .eq("type", "privacy")
      .eq("status", "published")
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

    // If no published docs exist at all, skip consent gracefully
    if (!tncDoc && !privacyDoc) {
      setState({ needsConsent: false, isReConsent: false, tncVersion: null, privacyVersion: null, changeSummary: null, loading: false });
      return;
    }

    // Fetch user's latest consent record
    const { data: userConsent } = await supabase
      .from("user_consents")
      .select("tnc_version, privacy_version")
      .eq("user_id", userId)
      .order("consented_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let needsConsent = false;
    let isReConsent  = false;

    if (!userConsent) {
      // Never consented before
      needsConsent = true;
    } else {
      // Check whether re-acceptance is needed for either document
      if (tncDoc?.requires_reacceptance && userConsent.tnc_version < tncDoc.version) {
        needsConsent = true;
        isReConsent  = true;
      }
      if (privacyDoc?.requires_reacceptance && userConsent.privacy_version < privacyDoc.version) {
        needsConsent = true;
        isReConsent  = true;
      }
    }

    const changeSummary = tncDoc?.change_summary || privacyDoc?.change_summary || null;

    setState({
      needsConsent,
      isReConsent,
      tncVersion:    tncDoc?.version     ?? null,
      privacyVersion: privacyDoc?.version ?? null,
      changeSummary,
      loading: false,
    });
  }, [userId]);

  useEffect(() => {
    check();
  }, [check]);

  return { ...state, refetch: check };
}
