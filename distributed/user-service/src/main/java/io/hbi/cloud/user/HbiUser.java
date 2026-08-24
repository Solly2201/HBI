package io.hbi.cloud.user;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;

/**
 * An anonymous HBI player. Lives in user_db, which no other service touches.
 *
 * There are no accounts: a row is created when a player starts a session with
 * a display name, and the id is what the JWT (and every other service)
 * identifies the player by.
 */
@Entity
@Table(name = "hbi_user")
public class HbiUser {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "display_name", nullable = false, length = 40)
    private String displayName;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();

    protected HbiUser() {
        // for JPA
    }

    public HbiUser(String displayName) {
        this.displayName = displayName;
        this.createdAt = Instant.now();
    }

    public Long getId() {
        return id;
    }

    public String getDisplayName() {
        return displayName;
    }

    public void setDisplayName(String displayName) {
        this.displayName = displayName;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
