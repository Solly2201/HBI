package io.hbi.cloud.user;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * Both registration and login look users up by {@code lower(email)}, which the
 * plain unique index on {@code email} cannot serve — Postgres falls back to a
 * sequential scan. Hibernate cannot declare a functional index from an
 * annotation, so it is created here at startup instead. Idempotent.
 */
@Component
public class EmailIndexInitializer implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(EmailIndexInitializer.class);

    private final JdbcTemplate jdbc;

    public EmailIndexInitializer(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public void run(ApplicationArguments args) {
        try {
            jdbc.execute("CREATE UNIQUE INDEX IF NOT EXISTS ix_hbi_user_email_lower "
                    + "ON hbi_user (lower(email))");
            log.info("functional index ix_hbi_user_email_lower is in place");
        } catch (Exception e) {
            // Unique creation can fail if pre-existing rows differ only by
            // case. The service still works without the index, just slower.
            log.warn("could not create ix_hbi_user_email_lower: {}", e.getMessage());
        }
    }
}
