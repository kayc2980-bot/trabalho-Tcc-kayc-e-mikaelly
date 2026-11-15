-- Taskly - Migracao 001: estrutura inicial
-- Esta migracao documenta a estrutura aplicada no projeto Supabase.
-- Execute em um banco novo; no projeto atual, as tabelas ja foram criadas pelo SQL Editor.

CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL DEFAULT 'Meu perfil',
    email TEXT,
    bio TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    category TEXT NOT NULL DEFAULT 'Outros'
        CHECK (category IN ('Estudos', 'Pessoal', 'Trabalho', 'Outros')),
    priority TEXT NOT NULL DEFAULT 'medium'
        CHECK (priority IN ('low', 'medium', 'high')),
    due_date DATE,
    due_time TIME,
    completed BOOLEAN NOT NULL DEFAULT FALSE,
    subtasks JSONB NOT NULL DEFAULT '[]'::JSONB
        CHECK (jsonb_typeof(subtasks) = 'array'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_profiles_owner
    ON public.profiles(owner_id);
CREATE INDEX IF NOT EXISTS idx_tasks_profile
    ON public.tasks(profile_id);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date
    ON public.tasks(due_date);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='profiles' AND policyname='Usuarios visualizam seus perfis') THEN
        CREATE POLICY "Usuarios visualizam seus perfis" ON public.profiles
        FOR SELECT TO authenticated USING (owner_id = (SELECT auth.uid()));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='profiles' AND policyname='Usuarios criam seus perfis') THEN
        CREATE POLICY "Usuarios criam seus perfis" ON public.profiles
        FOR INSERT TO authenticated WITH CHECK (owner_id = (SELECT auth.uid()));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='profiles' AND policyname='Usuarios atualizam seus perfis') THEN
        CREATE POLICY "Usuarios atualizam seus perfis" ON public.profiles
        FOR UPDATE TO authenticated USING (owner_id = (SELECT auth.uid()))
        WITH CHECK (owner_id = (SELECT auth.uid()));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='profiles' AND policyname='Usuarios excluem seus perfis') THEN
        CREATE POLICY "Usuarios excluem seus perfis" ON public.profiles
        FOR DELETE TO authenticated USING (owner_id = (SELECT auth.uid()));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='tasks' AND policyname='Usuarios visualizam suas tarefas') THEN
        CREATE POLICY "Usuarios visualizam suas tarefas" ON public.tasks
        FOR SELECT TO authenticated USING (
            EXISTS (SELECT 1 FROM public.profiles
                    WHERE profiles.id = tasks.profile_id
                    AND profiles.owner_id = (SELECT auth.uid()))
        );
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='tasks' AND policyname='Usuarios criam suas tarefas') THEN
        CREATE POLICY "Usuarios criam suas tarefas" ON public.tasks
        FOR INSERT TO authenticated WITH CHECK (
            EXISTS (SELECT 1 FROM public.profiles
                    WHERE profiles.id = tasks.profile_id
                    AND profiles.owner_id = (SELECT auth.uid()))
        );
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='tasks' AND policyname='Usuarios atualizam suas tarefas') THEN
        CREATE POLICY "Usuarios atualizam suas tarefas" ON public.tasks
        FOR UPDATE TO authenticated USING (
            EXISTS (SELECT 1 FROM public.profiles
                    WHERE profiles.id = tasks.profile_id
                    AND profiles.owner_id = (SELECT auth.uid()))
        ) WITH CHECK (
            EXISTS (SELECT 1 FROM public.profiles
                    WHERE profiles.id = tasks.profile_id
                    AND profiles.owner_id = (SELECT auth.uid()))
        );
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='tasks' AND policyname='Usuarios excluem suas tarefas') THEN
        CREATE POLICY "Usuarios excluem suas tarefas" ON public.tasks
        FOR DELETE TO authenticated USING (
            EXISTS (SELECT 1 FROM public.profiles
                    WHERE profiles.id = tasks.profile_id
                    AND profiles.owner_id = (SELECT auth.uid()))
        );
    END IF;
END
$$;
