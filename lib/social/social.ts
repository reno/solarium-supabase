import type { SupabaseClient } from "@supabase/supabase-js";

// Likes and comments are ordinary off-chain rows under RLS — no chain
// interaction, no activity rows (the activities.type check constraint only
// allows mint/sale/gift/list/delist).

export async function likeNft(
  supabase: SupabaseClient,
  { nftId, userId }: { nftId: string; userId: string }
): Promise<void> {
  const { error } = await supabase
    .from("likes")
    .insert({ nft_id: nftId, profile_id: userId });
  if (error && error.code !== "23505") {
    throw new Error(`Failed to like this NFT: ${error.message}`);
  }
}

export async function unlikeNft(
  supabase: SupabaseClient,
  { nftId, userId }: { nftId: string; userId: string }
): Promise<void> {
  const { error } = await supabase
    .from("likes")
    .delete()
    .eq("nft_id", nftId)
    .eq("profile_id", userId);
  if (error) {
    throw new Error(`Failed to unlike this NFT: ${error.message}`);
  }
}

export async function addComment(
  supabase: SupabaseClient,
  { nftId, userId, body }: { nftId: string; userId: string; body: string }
): Promise<{ id: string; body: string; createdAt: string }> {
  const trimmed = body.trim();
  if (trimmed.length === 0) {
    throw new Error("Comment cannot be empty.");
  }
  if (trimmed.length > 1000) {
    throw new Error("Comment must be 1000 characters or fewer.");
  }

  const { data, error } = await supabase
    .from("comments")
    .insert({ nft_id: nftId, profile_id: userId, body: trimmed })
    .select("id, body, created_at")
    .single();
  if (error) {
    throw new Error(`Failed to post comment: ${error.message}`);
  }
  return { id: data.id, body: data.body, createdAt: data.created_at };
}

export async function followProfile(
  supabase: SupabaseClient,
  { followerId, followeeId }: { followerId: string; followeeId: string }
): Promise<void> {
  if (followerId === followeeId) {
    throw new Error("You can't follow yourself.");
  }
  const { error } = await supabase
    .from("follows")
    .insert({ follower_id: followerId, followee_id: followeeId });
  if (error && error.code !== "23505") {
    throw new Error(`Failed to follow this profile: ${error.message}`);
  }
}

export async function unfollowProfile(
  supabase: SupabaseClient,
  { followerId, followeeId }: { followerId: string; followeeId: string }
): Promise<void> {
  const { error } = await supabase
    .from("follows")
    .delete()
    .eq("follower_id", followerId)
    .eq("followee_id", followeeId);
  if (error) {
    throw new Error(`Failed to unfollow this profile: ${error.message}`);
  }
}

export async function deleteComment(
  supabase: SupabaseClient,
  { commentId, userId }: { commentId: string; userId: string }
): Promise<void> {
  const { error } = await supabase
    .from("comments")
    .delete()
    .eq("id", commentId)
    .eq("profile_id", userId);
  if (error) {
    throw new Error(`Failed to delete comment: ${error.message}`);
  }
}
