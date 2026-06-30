import { SupabaseService } from "../../auth/supabase.service";

export const USER_PROFILE_PICTURES_BUCKET = "user-profile-pictures";
export const USER_AVATAR_SIGNED_URL_TTL_SECONDS = 60 * 60;

export async function getUserAvatarSignedUrl(params: {
  supabaseService: SupabaseService;
  avatarKey: string | null | undefined;
  onError?: (error: { message?: string } | null | undefined) => never;
}): Promise<string | null> {
  const key = String(params.avatarKey ?? "").trim();
  if (!key) return null;
  const { data, error } = await params.supabaseService
    .getClient()
    .storage.from(USER_PROFILE_PICTURES_BUCKET)
    .createSignedUrl(key, USER_AVATAR_SIGNED_URL_TTL_SECONDS);

  if (error || !data?.signedUrl) {
    if (error && params.onError) params.onError(error);
    return null;
  }
  return data.signedUrl;
}
