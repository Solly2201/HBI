-- Migration from the restaurant era to the food-item domain.
--
-- Runs before Hibernate (spring.sql.init.mode: always), so that on a database
-- created before this change the NOT NULL restaurant_id columns are gone by the
-- time ddl-auto adds the NOT NULL food_id columns — which would otherwise fail
-- on non-empty tables. Restaurant-era rows are deleted outright: they reference
-- restaurants, which no longer exist as a concept, so they cannot be mapped.
-- On a fresh database every block is a no-op. Idempotent by construction.

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'rating' AND column_name = 'restaurant_id') THEN
        DELETE FROM rating;
        ALTER TABLE rating DROP COLUMN restaurant_id;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'room_candidate' AND column_name = 'restaurant_id') THEN
        DELETE FROM room_candidate;
        ALTER TABLE room_candidate DROP COLUMN restaurant_id;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'recommendation' AND column_name = 'restaurant_id') THEN
        DELETE FROM recommendation;
        ALTER TABLE recommendation DROP COLUMN restaurant_id;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'decision' AND column_name = 'restaurant_id') THEN
        DELETE FROM decision;
        ALTER TABLE decision DROP COLUMN restaurant_id;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'preference' AND column_name = 'max_budget') THEN
        ALTER TABLE preference DROP COLUMN max_budget;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'preference' AND column_name = 'max_distance_km') THEN
        ALTER TABLE preference DROP COLUMN max_distance_km;
    END IF;
END $$;
