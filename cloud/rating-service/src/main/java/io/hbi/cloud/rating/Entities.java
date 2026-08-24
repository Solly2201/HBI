package io.hbi.cloud.rating;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;

import java.time.Instant;
import java.util.Arrays;
import java.util.List;

/**
 * The four tables in rating_db. They are grouped in one file because they are
 * small and always read together.
 */
public final class Entities {

    private Entities() {
    }

    /** What one player is in the mood for. One row per (room, user). */
    @Entity
    @Table(name = "preference",
            uniqueConstraints = @UniqueConstraint(columnNames = {"room_code", "user_id"}))
    public static class Preference {

        @Id
        @GeneratedValue(strategy = GenerationType.IDENTITY)
        private Long id;

        @Column(name = "room_code", nullable = false, length = 12)
        private String roomCode;

        @Column(name = "user_id", nullable = false)
        private Long userId;

        /** Comma-separated cuisine names, e.g. "Indian,Chinese". */
        @Column(name = "cuisines", nullable = false, length = 400)
        private String cuisines = "";

        @Column(name = "max_budget", nullable = false)
        private Integer maxBudget;

        @Column(name = "max_distance_km", nullable = false)
        private Double maxDistanceKm;

        @Column(name = "updated_at", nullable = false)
        private Instant updatedAt = Instant.now();

        protected Preference() {
        }

        public Preference(String roomCode, Long userId) {
            this.roomCode = roomCode;
            this.userId = userId;
        }

        public Long getUserId() {
            return userId;
        }

        public String getRoomCode() {
            return roomCode;
        }

        public List<String> cuisineList() {
            if (cuisines == null || cuisines.isBlank()) {
                return List.of();
            }
            return Arrays.stream(cuisines.split(",")).map(String::trim).filter(s -> !s.isEmpty()).toList();
        }

        public void setCuisines(List<String> values) {
            this.cuisines = values == null ? "" : String.join(",", values);
        }

        public Integer getMaxBudget() {
            return maxBudget;
        }

        public void setMaxBudget(Integer maxBudget) {
            this.maxBudget = maxBudget;
        }

        public Double getMaxDistanceKm() {
            return maxDistanceKm;
        }

        public void setMaxDistanceKm(Double maxDistanceKm) {
            this.maxDistanceKm = maxDistanceKm;
        }

        public void touch() {
            this.updatedAt = Instant.now();
        }
    }

    /** One player's score for one restaurant. Re-submitting overwrites. */
    @Entity
    @Table(name = "rating",
            uniqueConstraints = @UniqueConstraint(columnNames = {"room_code", "user_id", "restaurant_id"}))
    public static class Rating {

        @Id
        @GeneratedValue(strategy = GenerationType.IDENTITY)
        private Long id;

        @Column(name = "room_code", nullable = false, length = 12)
        private String roomCode;

        @Column(name = "user_id", nullable = false)
        private Long userId;

        @Column(name = "restaurant_id", nullable = false)
        private Long restaurantId;

        /** 1..5, matching the HBI "eat-o-meter". */
        @Column(nullable = false)
        private Integer score;

        @Column(name = "submitted_at", nullable = false)
        private Instant submittedAt = Instant.now();

        protected Rating() {
        }

        public Rating(String roomCode, Long userId, Long restaurantId, Integer score) {
            this.roomCode = roomCode;
            this.userId = userId;
            this.restaurantId = restaurantId;
            this.score = score;
        }

        public Long getUserId() {
            return userId;
        }

        public Long getRestaurantId() {
            return restaurantId;
        }

        public Integer getScore() {
            return score;
        }

        public void setScore(Integer score) {
            this.score = score;
            this.submittedAt = Instant.now();
        }
    }

    /**
     * The restaurants a room is rating.
     *
     * The shortlist is worked out once from the group's preferences and then
     * frozen, so a player joining halfway through cannot change what everyone
     * else is already rating.
     */
    @Entity
    @Table(name = "room_candidate",
            uniqueConstraints = @UniqueConstraint(columnNames = {"room_code", "restaurant_id"}))
    public static class Candidate {

        @Id
        @GeneratedValue(strategy = GenerationType.IDENTITY)
        private Long id;

        @Column(name = "room_code", nullable = false, length = 12)
        private String roomCode;

        @Column(name = "restaurant_id", nullable = false)
        private Long restaurantId;

        @Column(name = "position_no", nullable = false)
        private Integer position;

        protected Candidate() {
        }

        public Candidate(String roomCode, Long restaurantId, Integer position) {
            this.roomCode = roomCode;
            this.restaurantId = restaurantId;
            this.position = position;
        }

        public Long getRestaurantId() {
            return restaurantId;
        }

        public Integer getPosition() {
            return position;
        }
    }

    /** A scored candidate, rewritten every time the engine runs for a room. */
    @Entity
    @Table(name = "recommendation")
    public static class Recommendation {

        @Id
        @GeneratedValue(strategy = GenerationType.IDENTITY)
        private Long id;

        @Column(name = "room_code", nullable = false, length = 12)
        private String roomCode;

        @Column(name = "restaurant_id", nullable = false)
        private Long restaurantId;

        @Column(name = "position_no", nullable = false)
        private Integer position;

        @Column(nullable = false)
        private Double score;

        @Column(name = "generated_at", nullable = false)
        private Instant generatedAt = Instant.now();

        protected Recommendation() {
        }

        public Recommendation(String roomCode, Long restaurantId, Integer position, Double score) {
            this.roomCode = roomCode;
            this.restaurantId = restaurantId;
            this.position = position;
            this.score = score;
        }

        public Long getRestaurantId() {
            return restaurantId;
        }

        public Integer getPosition() {
            return position;
        }

        public Double getScore() {
            return score;
        }

        public Instant getGeneratedAt() {
            return generatedAt;
        }
    }

    /** The room's locked-in answer. One row per room. */
    @Entity
    @Table(name = "decision", uniqueConstraints = @UniqueConstraint(columnNames = {"room_code"}))
    public static class Decision {

        @Id
        @GeneratedValue(strategy = GenerationType.IDENTITY)
        private Long id;

        @Column(name = "room_code", nullable = false, length = 12)
        private String roomCode;

        @Column(name = "restaurant_id", nullable = false)
        private Long restaurantId;

        @Column(name = "final_score", nullable = false)
        private Double finalScore;

        /** AUTO when everyone finished rating, HOST when the host forced it. */
        @Column(name = "decided_by", nullable = false, length = 16)
        private String decidedBy;

        @Column(name = "decided_at", nullable = false)
        private Instant decidedAt = Instant.now();

        protected Decision() {
        }

        public Decision(String roomCode, Long restaurantId, Double finalScore, String decidedBy) {
            this.roomCode = roomCode;
            this.restaurantId = restaurantId;
            this.finalScore = finalScore;
            this.decidedBy = decidedBy;
        }

        public String getRoomCode() {
            return roomCode;
        }

        public Long getRestaurantId() {
            return restaurantId;
        }

        public Double getFinalScore() {
            return finalScore;
        }

        public String getDecidedBy() {
            return decidedBy;
        }

        public Instant getDecidedAt() {
            return decidedAt;
        }
    }
}
