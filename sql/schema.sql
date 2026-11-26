-- 박현민 AI 오피스 · 공용 DB 스키마 (Supabase / hyunmin-office)
-- 실행 위치: Supabase 대시보드 → SQL Editor (2026-11-26 생성)

create extension if not exists pgcrypto;

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  room text not null default 'main',
  sender text not null,
  role text not null default 'user',
  text text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.memos (
  id uuid primary key default gen_random_uuid(),
  text text not null,
  created_at timestamptz not null default now()
);

create index if not exists messages_created_idx on public.messages (created_at desc);
create index if not exists memos_created_idx on public.memos (created_at desc);

-- anon(공개 키) 역할 권한: 오피스 공용 읽기/쓰기/삭제
grant usage on schema public to anon;
grant select, insert, delete on public.messages to anon;
grant select, insert, delete on public.memos to anon;

alter table public.messages enable row level security;
alter table public.memos enable row level security;

drop policy if exists office_read_messages on public.messages;
drop policy if exists office_insert_messages on public.messages;
drop policy if exists office_delete_messages on public.messages;
create policy office_read_messages on public.messages for select to anon using (true);
create policy office_insert_messages on public.messages for insert to anon with check (true);
create policy office_delete_messages on public.messages for delete to anon using (true);

drop policy if exists office_read_memos on public.memos;
drop policy if exists office_insert_memos on public.memos;
drop policy if exists office_delete_memos on public.memos;
create policy office_read_memos on public.memos for select to anon using (true);
create policy office_insert_memos on public.memos for insert to anon with check (true);
create policy office_delete_memos on public.memos for delete to anon using (true);

-- Realtime 발행 대상 등록
do $$
begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.memos;
exception when duplicate_object then null;
end $$;

-- 초기 안내 메시지 (테이블이 비어 있을 때만)
insert into public.messages (room, sender, role, text, created_at)
select t.room, t.sender, t.role, t.text, t.created_at
from (values
  ('all','nari','assistant','대장님, 11월 26일 목요일 오피스 열었습니다 🧡 네이버 클립 27호는 어제 19:30 배달 끝났고, 원컷 스레드 08:30도 나갔어요. 오늘 클립 28호는 19:30에 올릴게요.', now() - interval '3 hours'),
  ('all','dali','assistant','대장님, 달이도 대회의실 도착했습니다 💙 블로그·체험단·당근 쪽은 제가 맡을게요. 20:30 원컷 블로그 초안 미리 준비해 둘게요.', now() - interval '2 hours 55 minutes'),
  ('all','nari','assistant','크몽 7종 아침 확인했어요. 1호만 판매중이고 나머지 6종은 심사 중입니다. 문의 들어오면 바로 보고드릴게요.', now() - interval '2 hours 40 minutes'),
  ('all','dali','assistant','유튜브는 응? 채널만 남기고 엉?·미국·Huh? 모두 중지 상태 그대로예요. 재개 지시 주시면 26호부터 준비할게요.', now() - interval '2 hours 30 minutes'),
  ('all','system','system','공용 DB 연결 완료 · 이 방의 대화는 이제 폰·PC·나리·달이가 함께 봅니다. (2026-11-26)', now())
) as t(room, sender, role, text, created_at)
where not exists (select 1 from public.messages);
