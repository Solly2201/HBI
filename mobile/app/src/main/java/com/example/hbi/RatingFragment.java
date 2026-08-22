package com.example.hbi;

import android.os.Bundle;
import android.util.Log;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.ImageView;
import android.widget.SeekBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.fragment.app.Fragment;
import androidx.navigation.NavController;
import androidx.navigation.Navigation;

import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.firestore.FirebaseFirestore;
import com.google.firebase.firestore.ListenerRegistration;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

public class RatingFragment extends Fragment {

    private static final String TAG = "RatingFragment";
    private ImageView foodItemImage;
    private TextView foodItemName;
    private SeekBar ratingSlider;
    private Button ratingNextBtn, blendBtn;

    private FirebaseFirestore db;
    private NavController navController;
    private String roomId;
    private ListenerRegistration roomListener;

    private String currentUserName;
    private boolean isCurrentUserHost = false;

    private List<Map<String, Object>> foodListToRate = new ArrayList<>();
    private List<Map<String, Object>> userRatings = new ArrayList<>();
    private int currentFoodIndex = 0;

    @Override
    public View onCreateView(LayoutInflater inflater, ViewGroup container, Bundle savedInstanceState) {
        return inflater.inflate(R.layout.fragment_rating, container, false);
    }

    @Override
    public void onViewCreated(@NonNull View view, @Nullable Bundle savedInstanceState) {
        super.onViewCreated(view, savedInstanceState);

        db = FirebaseFirestore.getInstance();
        navController = Navigation.findNavController(view);

        if (getArguments() != null) {
            roomId = RatingFragmentArgs.fromBundle(getArguments()).getRoomId();
            currentUserName = RatingFragmentArgs.fromBundle(getArguments()).getUserName();
        }

        foodItemImage = view.findViewById(R.id.food_item_image);
        foodItemName = view.findViewById(R.id.food_item_name);
        ratingSlider = view.findViewById(R.id.rating_slider);
        ratingNextBtn = view.findViewById(R.id.rating_next_btn);
        blendBtn = view.findViewById(R.id.blend_btn);

        ratingNextBtn.setOnClickListener(v -> onNextClick());
        blendBtn.setOnClickListener(v -> onBlendClick());

        listenForRoomUpdates();
    }

    private void listenForRoomUpdates() {
        if (roomId == null) return;
        roomListener = db.collection("rooms").document(roomId)
                .addSnapshotListener((snapshot, error) -> {
                    if (error != null || snapshot == null || !snapshot.exists()) {
                        Log.w(TAG, "Listen failed.", error);
                        return;
                    }

                    if (foodListToRate.isEmpty() && snapshot.contains("foodList")) {
                        foodListToRate = (List<Map<String, Object>>) snapshot.get("foodList");
                        if (foodListToRate != null && !foodListToRate.isEmpty()) {
                            displayCurrentFoodItem();
                        }
                    }

                    List<Map<String, Object>> playersData = (List<Map<String, Object>>) snapshot.get("players");
                    if (playersData != null) {
                        for (Map<String, Object> playerData : playersData) {
                            if (Objects.equals(playerData.get("name"), currentUserName) && (Boolean) playerData.get("isHost")) {
                                isCurrentUserHost = true;
                                break;
                            }
                        }
                    }

                    if (isCurrentUserHost) {
                        int playerCount = playersData != null ? playersData.size() : 0;
                        Map<String, Object> ratingsData = (Map<String, Object>) snapshot.get("ratings");
                        int ratingCount = ratingsData != null ? ratingsData.size() : 0;

                        if (playerCount > 0 && playerCount == ratingCount && "rating".equals(snapshot.getString("gameState"))) {
                            compileResults(ratingsData);
                        }
                    }

                    String gameState = snapshot.getString("gameState");
                    if ("results".equals(gameState)) {
                        if (navController.getCurrentDestination() != null && navController.getCurrentDestination().getId() == R.id.ratingFragment) {
                            RatingFragmentDirections.ActionRatingFragmentToResultsFragment action =
                                    RatingFragmentDirections.actionRatingFragmentToResultsFragment(roomId);
                            navController.navigate(action);
                        }
                    }
                });
    }

    private void compileResults(Map<String, Object> ratingsData) {
        Map<String, Map<String, Object>> compiledScores = new HashMap<>();

        for (Object playerRatingsObj : ratingsData.values()) {
            List<Map<String, Object>> playerRatings = (List<Map<String, Object>>) playerRatingsObj;
            for (Map<String, Object> foodRating : playerRatings) {
                String foodName = (String) foodRating.get("name");
                if (!compiledScores.containsKey(foodName)) {
                    Map<String, Object> scoreData = new HashMap<>();
                    scoreData.put("totalScore", 0.0);
                    scoreData.put("count", 0);
                    scoreData.put("cuisine", foodRating.get("cuisine"));
                    compiledScores.put(foodName, scoreData);
                }
                Map<String, Object> currentScore = compiledScores.get(foodName);
                currentScore.put("totalScore", (double) currentScore.get("totalScore") + ((Long) foodRating.get("rating")).doubleValue());
                currentScore.put("count", (int) currentScore.get("count") + 1);
            }
        }

        List<Map<String, Object>> results = new ArrayList<>();
        for (Map.Entry<String, Map<String, Object>> entry : compiledScores.entrySet()) {
            Map<String, Object> data = entry.getValue();
            double avgScore = (double) data.get("totalScore") / (int) data.get("count");
            Map<String, Object> resultItem = new HashMap<>();
            resultItem.put("name", entry.getKey());
            resultItem.put("avgScore", avgScore);
            resultItem.put("cuisine", data.get("cuisine"));
            results.add(resultItem);
        }

        Collections.sort(results, (a, b) -> Double.compare((double) b.get("avgScore"), (double) a.get("avgScore")));
        List<Map<String, Object>> finalResults = results.size() > 5 ? results.subList(0, 5) : results;

        db.collection("rooms").document(roomId).update(
                "gameState", "results",
                "finalResults", finalResults
        );
    }

    private void displayCurrentFoodItem() {
        if (currentFoodIndex < foodListToRate.size()) {
            Map<String, Object> food = foodListToRate.get(currentFoodIndex);
            foodItemName.setText((String) food.get("name"));
            foodItemImage.setImageResource(R.drawable.angwy); // Placeholder
            ratingSlider.setProgress(2);

            boolean isLastItem = (currentFoodIndex == foodListToRate.size() - 1);
            if (isLastItem) {
                ratingNextBtn.setVisibility(View.GONE);
                blendBtn.setVisibility(View.VISIBLE);
            } else if (userRatings.size() >= 5) {
                ratingNextBtn.setVisibility(View.VISIBLE);
                blendBtn.setVisibility(View.VISIBLE);
            } else {
                ratingNextBtn.setVisibility(View.VISIBLE);
                blendBtn.setVisibility(View.GONE);
            }
        }
    }

    private void onNextClick() {
        saveCurrentRating();
        currentFoodIndex++;
        displayCurrentFoodItem();
    }

    private void onBlendClick() {
        saveCurrentRating();
        submitRatingsToFirestore();
        ratingNextBtn.setVisibility(View.GONE);
        blendBtn.setVisibility(View.GONE);
        foodItemName.setText("Waiting for others...");
        Toast.makeText(getContext(), "Ratings submitted! Waiting for results...", Toast.LENGTH_SHORT).show();
    }

    private void saveCurrentRating() {
        Map<String, Object> currentFood = foodListToRate.get(currentFoodIndex);
        Map<String, Object> rating = new HashMap<>();
        rating.put("name", currentFood.get("name"));
        rating.put("rating", ratingSlider.getProgress() + 1);
        rating.put("cuisine", currentFood.get("cuisine"));
        userRatings.add(rating);
    }

    private void submitRatingsToFirestore() {
        String userId = Objects.requireNonNull(FirebaseAuth.getInstance().getCurrentUser()).getUid();
        db.collection("rooms").document(roomId)
                .update("ratings." + userId, userRatings)
                .addOnSuccessListener(aVoid -> Log.d(TAG, "Ratings successfully written!"))
                .addOnFailureListener(e -> Log.w(TAG, "Error writing ratings", e));
    }

    @Override
    public void onDestroyView() {
        super.onDestroyView();
        if (roomListener != null) {
            roomListener.remove();
        }
    }
}