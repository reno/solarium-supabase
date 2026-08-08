-- Accepting a collection offer binds it to the item being sold (settle sets nft_id and
-- flips status to 'accepted'), but `offers_one_target` demanded the two columns be
-- mutually exclusive at all times, so that bind failed with a check violation.
--
-- The exclusivity only ever meant something at creation: an offer is placed against
-- exactly one target. Once bound, a collection offer legitimately carries both — the
-- collection it was made against and the item it settled on (the complete/verify flow
-- reads nft_id; the offer's collection_id is still what the bid history means).

alter table public.offers drop constraint offers_one_target;

alter table public.offers add constraint offers_one_target check (
  case
    -- Standing (unbound) offers: exactly one target, never both or neither.
    when status = 'active' then (nft_id is null) <> (collection_id is null)
    -- Bound/closed offers: a collection offer gains an nft_id when accepted.
    else nft_id is not null or collection_id is not null
  end
);
