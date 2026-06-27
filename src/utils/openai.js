import { supabase } from "./supabase";

/**
 * OpenAI Whisper speech-to-text via Supabase Edge Function.
 * The OpenAI API key lives in Supabase secrets — never in the browser bundle.
 */
export async function whisperTranscribe(audioBlob, languageCode) {
  // Convert Blob → base64 via FileReader (handles large files safely)
  const audioBase64 = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(audioBlob);
  });

  const { data, error } = await supabase.functions.invoke("whisper", {
    body: {
      audioBase64,
      mimeType:  audioBlob.type || "audio/webm",
      language:  languageCode || undefined,
    },
  });

  if (error) throw new Error(error.message || "Whisper transcription failed");
  if (data?.error) throw new Error(data.error);
  return data?.text || "";
}
