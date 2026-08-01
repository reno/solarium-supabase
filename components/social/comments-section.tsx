"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { useSyncCommentsCount } from "@/components/social/comments-visibility";
import { addComment, deleteComment } from "@/lib/social/social";
import { createClient } from "@/lib/supabase/client";

export type CommentEntry = {
  id: string;
  body: string;
  createdAt: string;
  authorId: string;
  authorName: string;
  authorUsername: string | null;
};

export function CommentsSection({
  nftId,
  viewerId,
  viewerName,
  viewerUsername,
  initialComments,
}: {
  nftId: string;
  viewerId: string | null;
  viewerName?: string;
  viewerUsername?: string | null;
  initialComments: CommentEntry[];
}) {
  const [comments, setComments] = useState(initialComments);
  useSyncCommentsCount(comments.length);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const supabase = useMemo(() => createClient(), []);

  const sorted = [...comments].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  const submit = async () => {
    if (!viewerId || draft.trim().length === 0 || posting) return;
    setPosting(true);
    setError(null);
    try {
      const created = await addComment(supabase, {
        nftId,
        userId: viewerId,
        body: draft,
      });
      setComments((prev) => [
        {
          id: created.id,
          body: created.body,
          createdAt: created.createdAt,
          authorId: viewerId,
          authorName: viewerName ?? "You",
          authorUsername: viewerUsername ?? null,
        },
        ...prev,
      ]);
      setDraft("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to post comment.");
    } finally {
      setPosting(false);
    }
  };

  const remove = async (commentId: string) => {
    if (!viewerId) return;
    setDeletingId(commentId);
    setError(null);
    try {
      await deleteComment(supabase, { commentId, userId: viewerId });
      setComments((prev) => prev.filter((c) => c.id !== commentId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete comment.");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col gap-4">
        {sorted.map((comment) => (
          <li
            key={comment.id}
            className="border-t border-zinc-200 pt-4 dark:border-zinc-800"
          >
            <div className="flex items-center justify-between gap-2">
              {comment.authorUsername ? (
                <Link
                  href={`/u/${comment.authorUsername}`}
                  className="text-sm font-medium underline-offset-4 hover:underline"
                >
                  {comment.authorName}
                </Link>
              ) : (
                <p className="text-sm font-medium">{comment.authorName}</p>
              )}
              <div className="flex items-center gap-2">
                <p className="text-xs text-zinc-500">
                  {new Date(comment.createdAt).toLocaleDateString()}
                </p>
                {viewerId === comment.authorId && (
                  <button
                    type="button"
                    onClick={() => remove(comment.id)}
                    disabled={deletingId === comment.id}
                    className="text-xs text-zinc-500 underline-offset-4 hover:underline disabled:opacity-50"
                  >
                    {deletingId === comment.id ? "Deleting…" : "Delete"}
                  </button>
                )}
              </div>
            </div>
            <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300">
              {comment.body}
            </p>
          </li>
        ))}
      </ul>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {viewerId ? (
        <div className="flex flex-col gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Add a comment…"
            rows={3}
            maxLength={1000}
            className="w-full resize-none rounded-lg border border-zinc-200 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-400 dark:border-zinc-800 dark:focus:border-zinc-600"
          />
          <div>
            <button
              type="button"
              onClick={submit}
              disabled={draft.trim().length === 0 || posting}
              className="rounded-full bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-black dark:hover:bg-zinc-300"
            >
              {posting ? "Posting…" : "Comment"}
            </button>
          </div>
        </div>
      ) : (
        <p className="border-t border-zinc-200 pt-4 text-sm text-zinc-500 dark:border-zinc-800">
          Sign in with your wallet to comment.
        </p>
      )}
    </div>
  );
}
