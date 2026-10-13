-- LogicLift: safe to run more than once

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text default '',
  role text not null default 'student' check (role in ('student','teacher')),
  created_at timestamptz default now()
);

create table if not exists public.questions (
  id bigint generated always as identity primary key,
  language text not null default 'English',
  subject text not null,
  difficulty text not null check (difficulty in ('Easy','Medium','Hard')),
  question text not null,
  options jsonb not null,
  answer int not null,
  hint text,
  explanation text,
  created_by uuid references public.profiles(id),
  created_at timestamptz default now()
);

create table if not exists public.attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  language text, subject text, difficulty text, source text,
  score numeric, total int, time_taken int,
  details jsonb,
  created_at timestamptz default now()
);

-- New signup -> profile row (always role 'student')
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name',''))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

-- Profiles for users who signed up before this script ran
insert into public.profiles(id)
select id from auth.users
on conflict (id) do nothing;

create or replace function public.is_teacher() returns boolean
language sql security definer set search_path = public stable as $$
  select exists(select 1 from public.profiles where id = auth.uid() and role = 'teacher')
$$;

-- Row Level Security
alter table public.profiles  enable row level security;
alter table public.questions enable row level security;
alter table public.attempts  enable row level security;

drop policy if exists "own or teacher reads profile" on public.profiles;
create policy "own or teacher reads profile" on public.profiles
  for select using (id = auth.uid() or public.is_teacher());

drop policy if exists "own profile update" on public.profiles;
create policy "own profile update" on public.profiles
  for update using (id = auth.uid());

-- students can change ONLY their name, never their role
revoke update on public.profiles from authenticated;
grant update (full_name) on public.profiles to authenticated;

drop policy if exists "logged-in users read questions" on public.questions;
create policy "logged-in users read questions" on public.questions
  for select to authenticated using (true);

drop policy if exists "teachers insert questions" on public.questions;
create policy "teachers insert questions" on public.questions
  for insert to authenticated with check (public.is_teacher());

drop policy if exists "teachers update questions" on public.questions;
create policy "teachers update questions" on public.questions
  for update to authenticated using (public.is_teacher());

drop policy if exists "teachers delete questions" on public.questions;
create policy "teachers delete questions" on public.questions
  for delete to authenticated using (public.is_teacher());

drop policy if exists "students insert own attempts" on public.attempts;
create policy "students insert own attempts" on public.attempts
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "own or teacher reads attempts" on public.attempts;
create policy "own or teacher reads attempts" on public.attempts
  for select to authenticated using (user_id = auth.uid() or public.is_teacher());

-- Make someone a teacher (do this manually, after they sign up):
-- update public.profiles set role = 'teacher' where id = '<their-user-id>';

-- Sample questions (added only if the table is empty)
insert into public.questions (language, subject, difficulty, question, options, answer, hint, explanation)
select * from (values
('English','Logical Reasoning','Easy','What comes next: 2, 4, 8, 16, ?','["24","32","30","64"]'::jsonb,1,'Each number is doubled.','Each term is multiplied by 2, so 16 × 2 = 32.'),
('English','Logical Reasoning','Medium','All roses are flowers. Some flowers fade quickly. Which must be true?','["All roses fade quickly","Some roses fade quickly","No rose fades quickly","None of these must be true"]'::jsonb,3,'"Some flowers" may not include any roses.','The fading flowers might not be roses, so nothing definite follows about roses.'),
('English','Logical Reasoning','Hard','A is taller than B. C is shorter than B. D is taller than A. Who is the shortest?','["A","B","C","D"]'::jsonb,2,'Order them from tallest to shortest.','D > A > B > C, so C is shortest.'),
('English','Mathematics','Easy','What is 15% of 200?','["20","25","30","35"]'::jsonb,2,'10% of 200 is 20.','15% = 10% + 5% = 20 + 10 = 30.'),
('English','Coding','Easy','Which symbol starts a single-line comment in JavaScript?','["#","//","--","/*"]'::jsonb,1,'Two slashes.','JavaScript uses // for single-line comments.'),
('English','General Knowledge','Easy','Which planet is known as the Red Planet?','["Venus","Jupiter","Mars","Saturn"]'::jsonb,2,'Named after the Roman god of war.','Iron oxide on its surface gives Mars a red color.')
) as v(language, subject, difficulty, question, options, answer, hint, explanation)
where not exists (select 1 from public.questions);