-- Synthetic data only, copied from the previously passed integration fixture.
DO $$ BEGIN IF current_database() NOT LIKE 'kandid_soft_removal_release_%' OR inet_server_addr() IS NOT NULL THEN RAISE EXCEPTION 'isolated test database required'; END IF; END $$;
BEGIN;
SET LOCAL session_replication_role = replica;
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,created_at,updated_at) VALUES
('10000000-0000-4000-8000-000000000001','authenticated','authenticated','board-a@example.invalid',now(),now(),now()),
('10000000-0000-4000-8000-000000000002','authenticated','authenticated','board-b@example.invalid',now(),now(),now()),
('10000000-0000-4000-8000-000000000003','authenticated','authenticated','admin@example.invalid',now(),now(),now()),
('10000000-0000-4000-8000-000000000004','authenticated','authenticated','student@example.invalid',now(),now(),now());
INSERT INTO public.organizations(id,name,organization_type,membership_scope) VALUES
(901,'Synthetic Program Org','departmental','program'),(902,'Synthetic Foreign Org','departmental','program');
INSERT INTO public.admin_users(id,full_name,email,role,organization_id,status,auth_user_id) VALUES
(901,'Synthetic Board A','board-a@example.invalid','electoral_board',901,'active','10000000-0000-4000-8000-000000000001'),
(902,'Synthetic Board B','board-b@example.invalid','electoral_board',902,'active','10000000-0000-4000-8000-000000000002'),
(903,'Synthetic Super Admin','admin@example.invalid','super_admin',null,'active','10000000-0000-4000-8000-000000000003');
INSERT INTO public.academic_terms(id,academic_year,semester,status) VALUES (901,'2099-2100','1st Semester','draft');
INSERT INTO public.students(id,student_number,first_name,last_name,status,program,year_level)
VALUES (901,'SYNTHETIC-901','Test','Student','active','BSIT','4');
INSERT INTO public.elections
(id,organization_id,title,status,created_at,start_date,end_date,campaign_start,campaign_end,results_released_at,academic_term_id,electorate_frozen_at,electorate_frozen_by)
VALUES
(91101,901,'Synthetic Removable Election','draft',now()::timestamp-interval '30 days',now()::timestamp-interval '20 days',now()::timestamp-interval '19 days',now()::timestamp-interval '40 days',now()::timestamp-interval '35 days',now(),901,now(),901),
(91102,901,'Synthetic Active Election','active',now()::timestamp,now()::timestamp+interval '1 day',now()::timestamp+interval '2 days',now()::timestamp,now()::timestamp+interval '12 hours',null,901,null,null),
(91103,902,'Synthetic Foreign Election','draft',now()::timestamp,now()::timestamp-interval '2 days',now()::timestamp-interval '1 day',null,null,null,901,null,null);
INSERT INTO public.positions(id,election_id,name,max_votes,display_order) VALUES (91101,91101,'Synthetic President',1,1);
INSERT INTO public.partylists(id,election_id,name,organization_id) VALUES (91101,91101,'Synthetic Party',901);
INSERT INTO public.candidates(id,position_id,student_id,partylist_id,campaign_status) VALUES (91101,91101,901,91101,'draft');
INSERT INTO public.candidate_media(id,candidate_id,media_url,media_type) VALUES (91101,91101,'https://example.invalid/synthetic.png','image');
INSERT INTO public.eligibility_rules(id,election_id,program,min_year_level,max_year_level,allow_shs) VALUES (91101,91101,'BSIT',1,4,false);
INSERT INTO public.election_access_tokens(id,election_id,token) VALUES (91101,91101,'synthetic-token');
INSERT INTO public.election_campaign_snapshots(id,election_id,organization_id,schema_version,capture_kind,campaign_start,campaign_end,snapshot_data,content_hash)
VALUES ('20000000-0000-4000-8000-000000000001',91101,901,'KANDID_CAMPAIGN_SNAPSHOT_V1','official_campaign_end',now()::timestamp-interval '40 days',now()::timestamp-interval '35 days','{}',repeat('a',64));
INSERT INTO private.election_eligible_voters(election_id,student_id) VALUES (91101,901);
INSERT INTO public.vote_ballots(id,student_id,election_id,canonical_submitted_at,ballot_hash,ballot_nonce,blockchain_anchor_status,blockchain_tx_id,blockchain_network,blockchain_contract_address,blockchain_block_number,blockchain_anchored_at)
VALUES ('30000000-0000-4000-8000-000000000001',901,91101,'2099-10-15T01:02:03.000Z','0x'||repeat('b',64),repeat('c',64),'anchored','0x'||repeat('d',64),'sepolia','0x'||repeat('e',40),12,now());
INSERT INTO public.votes(id,student_id,election_id,position_id,candidate_id,is_abstain,vote_hash,vote_nonce,canonical_vote_timestamp,hash_version,blockchain_anchor_status,blockchain_tx_id,blockchain_network,blockchain_contract_address,blockchain_anchored_at,blockchain_block_number,ballot_id)
VALUES (91101,901,91101,91101,91101,false,'0x'||repeat('f',64),repeat('b',64),'2099-10-15T01:02:03.000Z','KANDID_VOTE_V2','anchored','0x'||repeat('a',64),'sepolia','0x'||repeat('e',40),now(),12,'30000000-0000-4000-8000-000000000001');
INSERT INTO public.officers(id,student_id,organization_id,position_title,term_start,term_end,status,selection_type,is_current,display_order,officer_name,term_label,election_id,candidate_id,position_id,academic_term_id,leadership_academic_year)
VALUES (91101,901,901,'Synthetic President',current_date-10,current_date+100,'current','elected',true,1,'Synthetic Student','2099-2100',91101,91101,91101,901,'2099-2100');
INSERT INTO public.officer_new_roster(id,organization_id,election_id,selection_type,student_id,candidate_id,position_id,position_title,created_by,leadership_academic_year)
VALUES (91101,901,91101,'elected',901,91101,91101,'Synthetic President','10000000-0000-4000-8000-000000000003','2099-2100');
INSERT INTO public.officer_leadership_releases(id,organization_id,election_id,released_by,elected_count,appointed_count,academic_term_id,term_label,leadership_academic_year)
VALUES (91101,901,91101,'10000000-0000-4000-8000-000000000003',1,0,901,'2099-2100','2099-2100');
INSERT INTO public.election_officer_publications(id,election_id,organization_id,campaign_snapshot_id,published_by_admin_user_id,schema_version,content_hash)
VALUES ('40000000-0000-4000-8000-000000000001',91101,901,'20000000-0000-4000-8000-000000000001',903,'KANDID_OFFICER_PUBLICATION_V1',repeat('1',64));
INSERT INTO public.election_officer_publication_entries(id,publication_id,source_officer_id,display_order,display_name,position_title,selection_type)
VALUES ('50000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001',91101,0,'Synthetic Student','Synthetic President','elected');
INSERT INTO public.archived_elections(election_id,title,organization_id) VALUES (91101,'Synthetic Removable Election',901);
INSERT INTO public.audit_logs(user_id,actor_name,actor_role,action,event_type,event_category,entity_type,entity_id,entity_label,organization_id,organization_name,election_id,status,event_origin,metadata)
VALUES (903,'Synthetic Super Admin','super_admin','synthetic_historical_event','synthetic_historical_event','elections','election','91101','Synthetic Removable Election',901,'Synthetic Program Org',91101,'completed','test_fixture','{"historical":true}');
SET LOCAL session_replication_role = origin;
COMMIT;
