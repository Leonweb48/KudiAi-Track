-- ═══════════════════════════════════════════════════════════════
--  FIX USER DELETION: cascade all public → auth.users FK constraints
--  Any FK that was NO ACTION or RESTRICT will block auth.admin.deleteUser.
--  This migration drops and recreates each one with ON DELETE CASCADE.
-- ═══════════════════════════════════════════════════════════════

DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT
            tc.table_name,
            tc.constraint_name,
            kcu.column_name,
            rc.delete_rule
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
            ON  tc.constraint_name = kcu.constraint_name
            AND tc.table_schema    = kcu.table_schema
        JOIN information_schema.constraint_column_usage ccu
            ON  ccu.constraint_name = tc.constraint_name
        JOIN information_schema.referential_constraints rc
            ON  rc.constraint_name = tc.constraint_name
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_schema    = 'public'
          AND ccu.table_schema   = 'auth'
          AND ccu.table_name     = 'users'
          AND rc.delete_rule    IN ('NO ACTION', 'RESTRICT')
    LOOP
        RAISE NOTICE 'Fixing FK %  on %.% (was %)',
            r.constraint_name, 'public', r.table_name, r.delete_rule;

        EXECUTE format(
            'ALTER TABLE public.%I DROP CONSTRAINT %I',
            r.table_name, r.constraint_name
        );

        EXECUTE format(
            'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES auth.users(id) ON DELETE CASCADE',
            r.table_name, r.constraint_name, r.column_name
        );
    END LOOP;
END $$;
