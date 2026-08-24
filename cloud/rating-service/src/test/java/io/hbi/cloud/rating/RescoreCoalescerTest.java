package io.hbi.cloud.rating;

import io.hbi.cloud.rating.FoodClient.FoodView;
import io.hbi.cloud.rating.RecommendationEngine.ScoredFood;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The coalescing contract: many marks, one re-score per flush; failures are
 * retried on the next flush; the automatic decision still fires from the
 * flush when everyone has finished. Interval 0 disables the background
 * thread, so every flush here is explicit and deterministic.
 */
class RescoreCoalescerTest {

    private static final ScoredFood SCORED =
            new ScoredFood(new FoodView(1L, "Pizza", "Italian", "/images/pizza.jpg"),
                    0.9, 0.9, 1, 1.0, 1.0);

    private BlendService blend;
    private RoomBroadcaster broadcaster;
    private RescoreCoalescer coalescer;

    @BeforeEach
    void setUp() {
        blend = mock(BlendService.class);
        broadcaster = mock(RoomBroadcaster.class);
        coalescer = new RescoreCoalescer(blend, broadcaster, 0);

        when(blend.progress(anyString())).thenReturn(Map.of("roomId", "X"));
        when(blend.recomputeRecommendations(anyString())).thenReturn(List.of(SCORED));
        when(blend.storedRecommendations(anyString())).thenReturn(List.of());
        when(blend.everyoneHasFinished(anyString())).thenReturn(false);
    }

    @Test
    void aBurstOfMarksCostsExactlyOneRescore() {
        for (int i = 0; i < 25; i++) {
            coalescer.mark("HBIROOM");
        }
        coalescer.flush();

        verify(blend, times(1)).recomputeRecommendations("HBIROOM");
        verify(blend, times(1)).progress("HBIROOM");
        verify(broadcaster, times(1)).send(eq("HBIROOM"), eq("RATING_PROGRESS"), any());
        verify(broadcaster, times(1)).send(eq("HBIROOM"), eq("RECOMMENDATIONS_GENERATED"), any());
    }

    @Test
    void aFlushWithNothingDirtyDoesNothing() {
        coalescer.flush();
        verify(blend, never()).recomputeRecommendations(anyString());
    }

    @Test
    void distinctRoomsAreEachRescoredOnce() {
        coalescer.mark("ROOM-A");
        coalescer.mark("ROOM-B");
        coalescer.mark("ROOM-A");
        coalescer.flush();

        verify(blend, times(1)).recomputeRecommendations("ROOM-A");
        verify(blend, times(1)).recomputeRecommendations("ROOM-B");
    }

    @Test
    void aRoomIsNotRescoredAgainUntilMarkedAgain() {
        coalescer.mark("HBIROOM");
        coalescer.flush();
        coalescer.flush();
        verify(blend, times(1)).recomputeRecommendations("HBIROOM");

        coalescer.mark("HBIROOM");
        coalescer.flush();
        verify(blend, times(2)).recomputeRecommendations("HBIROOM");
    }

    @Test
    void theAutomaticDecisionFiresFromTheFlush() {
        when(blend.everyoneHasFinished("HBIROOM")).thenReturn(true);
        when(blend.finalise("HBIROOM", "AUTO"))
                .thenReturn(Optional.of(Map.of("roomId", "HBIROOM", "foodId", 1L)));

        coalescer.mark("HBIROOM");
        coalescer.flush();

        verify(blend, times(1)).finalise("HBIROOM", "AUTO");
        verify(broadcaster, times(1)).send(eq("HBIROOM"), eq("DECISION_FINALIZED"), any());
    }

    @Test
    void aFailedRescoreIsRetriedOnTheNextFlush() {
        // First progress call blows up; the second (next flush) succeeds.
        reset(blend);
        when(blend.progress("HBIROOM")).thenThrow(new RuntimeException("db hiccup"))
                .thenReturn(Map.of("roomId", "HBIROOM"));
        when(blend.recomputeRecommendations("HBIROOM")).thenReturn(List.of(SCORED));
        when(blend.storedRecommendations("HBIROOM")).thenReturn(List.of());
        when(blend.everyoneHasFinished("HBIROOM")).thenReturn(false);

        coalescer.mark("HBIROOM");
        coalescer.flush();   // fails, room re-queued
        verify(blend, never()).recomputeRecommendations("HBIROOM");

        coalescer.flush();   // retried without a new mark
        verify(blend, times(1)).recomputeRecommendations("HBIROOM");
    }
}
