-- ═══════════════════════════════════════════════════════════════
--  FIX USER DELETION v2: use pg_constraint (not information_schema)
--  information_schema is filtered by privileges and may miss FKs.
--  pg_constraint always shows everything the superuser can see.
-- ═══════════════════════════════════════════════════════════════

DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT
            c.conname                          AS constraint_name,
            c.conrelid::regclass               AS tbl,
            quote_ident(ns.nspname)            AS schema_name,
            quote_ident(rel.relname)           AS table_name,
            quote_ident(att.attname)           AS column_name,
            c.confdeltype                      AS del_type
        FROM pg_constraint c
        JOIN pg_class rel ON rel.oid = c.conrelid
        JOIN pg_namespace ns ON ns.oid = rel.relnamespace
        JOIN pg_attribute att
            ON att.attrelid = c.conrelid
            AND att.attnum = c.conkey[1]
        WHERE c.contype = 'f'
          AND ns.nspname = 'public'
          AND c.confrelid = 'auth.users'::regclass
          AND c.confdeltype IN ('a', 'r')   -- 'a'=NO ACTION  'r'=RESTRICT
    LOOP
        RAISE NOTICE 'Fixing % on %.% column % (del_type=%)',
            r.constraint_name, r.schema_name, r.table_name, r.column_name, r.del_type;

        EXECUTE format(
            'ALTER TABLE %s DROP CONSTRAINT %I',
            r.tbl, r.constraint_name
        );

        EXECUTE format(
            'ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY (%s) REFERENCES auth.users(id) ON DELETE CASCADE',
            r.tbl, r.constraint_name, r.column_name
        );
    END LOOP;
END $$;
