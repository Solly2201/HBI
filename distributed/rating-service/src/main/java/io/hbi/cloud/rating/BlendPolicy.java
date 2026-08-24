package io.hbi.cloud.rating;

/**
 * The two participation rules of the blend, kept as pure functions so they can
 * be unit-tested without a database and quoted in one place:
 *
 *  - a player may stop early once they have rated at least half the shortlist
 *    (rounded up), and
 *  - the host may start/force the blend once at least half of the currently
 *    active players (rounded up — "at least 50%") have reached that minimum.
 */
public final class BlendPolicy {

    private BlendPolicy() {
    }

    /**
     * Minimum ratings a player must submit before they may BLEND NOW.
     * Half the frozen shortlist, rounded up; never less than 1.
     */
    public static int minRatingsRequired(int shortlistSize) {
        return Math.max(1, (shortlistSize + 1) / 2);
    }

    /**
     * Whether the host may start or force the blend: at least 50% of the
     * currently active players have submitted the minimum number of ratings.
     * Exactly 50% qualifies. An empty room can never be blended.
     */
    public static boolean hostMayFinalize(int activeMembers, int eligibleMembers) {
        return activeMembers > 0 && eligibleMembers > 0
                && eligibleMembers * 2 >= activeMembers;
    }
}
