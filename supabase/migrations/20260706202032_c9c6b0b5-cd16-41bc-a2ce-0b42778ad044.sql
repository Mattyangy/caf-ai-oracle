
-- 1) Update handle_new_user to use fixed admin email instead of first-user rule
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  is_admin_email BOOLEAN;
BEGIN
  is_admin_email := lower(NEW.email) = lower('angileri.uil@gmail.com');

  INSERT INTO public.profiles (id, email, full_name, status)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', split_part(NEW.email, '@', 1)),
    CASE WHEN is_admin_email THEN 'approved'::public.user_status ELSE 'pending'::public.user_status END
  );

  IF is_admin_email THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin')
      ON CONFLICT (user_id, role) DO NOTHING;
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'operator')
      ON CONFLICT (user_id, role) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$function$;

-- Ensure the trigger exists on auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 2) Backfill: if the admin email already registered, promote them
DO $$
DECLARE
  admin_user_id uuid;
BEGIN
  SELECT id INTO admin_user_id FROM auth.users WHERE lower(email) = lower('angileri.uil@gmail.com') LIMIT 1;
  IF admin_user_id IS NOT NULL THEN
    UPDATE public.profiles SET status = 'approved'::public.user_status WHERE id = admin_user_id;
    INSERT INTO public.user_roles (user_id, role) VALUES (admin_user_id, 'admin')
      ON CONFLICT (user_id, role) DO NOTHING;
  END IF;
END $$;

-- 3) Add categoria column to documents (archivio_ai categories)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='documents' AND column_name='categoria'
  ) THEN
    ALTER TABLE public.documents ADD COLUMN categoria TEXT NOT NULL DEFAULT 'documenti';
    CREATE INDEX IF NOT EXISTS documents_categoria_idx ON public.documents(categoria);
  END IF;
END $$;
