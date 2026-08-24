package io.hbi.cloud.rating;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The two participation rules of the early blend. These are the numbers the
 * server enforces on /blend-now and /finalize, so they are pinned exactly.
 */
class BlendPolicyTest {

    // ------------------------------------------------ minimum rating count

    @Test
    void minimumIsHalfTheShortlistRoundedUp() {
        assertThat(BlendPolicy.minRatingsRequired(12)).isEqualTo(6);
        assertThat(BlendPolicy.minRatingsRequired(8)).isEqualTo(4);
        assertThat(BlendPolicy.minRatingsRequired(7)).isEqualTo(4);  // the 4A example: BLEND NOW at 4/7
        assertThat(BlendPolicy.minRatingsRequired(3)).isEqualTo(2);
        assertThat(BlendPolicy.minRatingsRequired(2)).isEqualTo(1);
    }

    @Test
    void minimumIsNeverBelowOne() {
        assertThat(BlendPolicy.minRatingsRequired(1)).isEqualTo(1);
        assertThat(BlendPolicy.minRatingsRequired(0)).isEqualTo(1);
    }

    // ------------------------------------------------ host 50% threshold

    @Test
    void hostBelowThresholdIsRejected() {
        // 1 of 3 active players eligible: 33% < 50%.
        assertThat(BlendPolicy.hostMayFinalize(3, 1)).isFalse();
        // 2 of 5: 40%.
        assertThat(BlendPolicy.hostMayFinalize(5, 2)).isFalse();
        // Nobody eligible at all.
        assertThat(BlendPolicy.hostMayFinalize(4, 0)).isFalse();
    }

    @Test
    void hostExactlyAtThresholdIsAllowed() {
        // "at least 50%": exactly half qualifies.
        assertThat(BlendPolicy.hostMayFinalize(2, 1)).isTrue();
        assertThat(BlendPolicy.hostMayFinalize(4, 2)).isTrue();
        assertThat(BlendPolicy.hostMayFinalize(8, 4)).isTrue();
        // Odd room sizes: 3 active need 2 (ceil), so 1 of 3 fails but 2 of 3 passes.
        assertThat(BlendPolicy.hostMayFinalize(3, 2)).isTrue();
    }

    @Test
    void hostAboveThresholdIsAllowed() {
        assertThat(BlendPolicy.hostMayFinalize(4, 3)).isTrue();
        assertThat(BlendPolicy.hostMayFinalize(5, 5)).isTrue();
    }

    @Test
    void thresholdUsesTheActivePlayerCountOnly() {
        // The caller passes only ACTIVE members. Two players left a 6-player
        // room; with 4 active, 2 eligible is now enough — the leavers neither
        // block the blend nor count toward it.
        assertThat(BlendPolicy.hostMayFinalize(4, 2)).isTrue();
        // Had the inactive pair been (wrongly) counted: 2 of 6 would fail.
        assertThat(BlendPolicy.hostMayFinalize(6, 2)).isFalse();
    }

    @Test
    void emptyOrUnreachableRoomCanNeverBeFinalized() {
        // activeMembers() returns an empty list when the room service is
        // unreachable; the threshold must fail safe.
        assertThat(BlendPolicy.hostMayFinalize(0, 0)).isFalse();
        assertThat(BlendPolicy.hostMayFinalize(0, 3)).isFalse();
    }
}
