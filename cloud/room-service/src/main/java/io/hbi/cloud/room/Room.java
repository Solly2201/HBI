package io.hbi.cloud.room;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;

/**
 * A blend session. The room {@code code} (e.g. HBI7X92) is the identifier the
 * players share with each other and the one used in the public API paths.
 */
@Entity
@Table(name = "room")
public class Room {

    /** Mirrors the HBI Web flow: lobby -> cuisines -> rating -> results. */
    public enum Status { LOBBY, PREFERENCES, RATING, DECIDED }

    /** Same cap as HBI Web. */
    public static final int MAX_MEMBERS = 8;

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, unique = true, length = 12)
    private String code;

    @Column(name = "host_user_id", nullable = false)
    private Long hostUserId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private Status status = Status.LOBBY;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();

    protected Room() {
        // for JPA
    }

    public Room(String code, Long hostUserId) {
        this.code = code;
        this.hostUserId = hostUserId;
        this.status = Status.LOBBY;
        this.createdAt = Instant.now();
    }

    public Long getId() {
        return id;
    }

    public String getCode() {
        return code;
    }

    public Long getHostUserId() {
        return hostUserId;
    }

    public void setHostUserId(Long hostUserId) {
        this.hostUserId = hostUserId;
    }

    public Status getStatus() {
        return status;
    }

    public void setStatus(Status status) {
        this.status = status;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
