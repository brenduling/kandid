-- REVIEW ONLY. Requires separate approval. Preserve existing images and URLs.
begin;
drop policy if exists election_covers_scoped_insert on storage.objects;
commit;
