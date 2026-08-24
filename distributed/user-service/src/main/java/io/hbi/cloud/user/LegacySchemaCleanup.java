package io.hbi.cloud.user;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * Drops the account-era columns from databases created before HBI became
 * anonymous-only.
 *
 * Hibernate's {@code ddl-auto: update} adds columns but never removes them,
 * so a user_db volume from the account era still carries NOT NULL
 * {@code email} / {@code password_hash} columns that would reject every new
 * session row. Fresh databases never have them and both statements no-op.
 */
@Component
public class LegacySchemaCleanup implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(LegacySchemaCleanup.class);

    private final JdbcTemplate jdbc;

    public LegacySchemaCleanup(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public void run(ApplicationArguments args) {
        try {
            jdbc.execute("ALTER TABLE hbi_user DROP COLUMN IF EXISTS password_hash");
            jdbc.execute("ALTER TABLE hbi_user DROP COLUMN IF EXISTS email");
            log.info("hbi_user carries no account-era columns");
        } catch (Exception e) {
            log.warn("could not drop legacy account columns: {}", e.getMessage());
        }
    }
}
