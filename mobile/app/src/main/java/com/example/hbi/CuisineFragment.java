package com.example.hbi;

import android.graphics.Color;
import android.os.Bundle;
import android.util.Log;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.Fragment;
import androidx.navigation.NavController;
import androidx.navigation.Navigation;

import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.firestore.FirebaseFirestore;
import com.google.firebase.firestore.ListenerRegistration;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

public class CuisineFragment extends Fragment {

    private static final String TAG = "CuisineFragment";
    private List<String> selectedCuisines = new ArrayList<>();
    private FirebaseFirestore db;
    private NavController navController;
    private String roomId;

    private ListenerRegistration roomListener;

    private String currentUserName;
    private boolean isCurrentUserHost = false;

    private final List<Map<String, Object>> MASTER_FOOD_LIST = new ArrayList<Map<String, Object>>() {{
        add(new HashMap<String, Object>() {{ put("name", "Pani Puri"); put("cuisine", "Indian"); }});
        add(new HashMap<String, Object>() {{ put("name", "Chole Bhature"); put("cuisine", "Indian"); }});
        add(new HashMap<String, Object>() {{ put("name", "Momos"); put("cuisine", "Indian"); }});
        add(new HashMap<String, Object>() {{ put("name", "Pav Bhaji"); put("cuisine", "Indian"); }});
        add(new HashMap<String, Object>() {{ put("name", "Dal Rice"); put("cuisine", "Indian"); }});
        add(new HashMap<String, Object>() {{ put("name", "Samosa"); put("cuisine", "Indian"); }});
        add(new HashMap<String, Object>() {{ put("name", "Aloo Paratha"); put("cuisine", "Indian"); }});
        add(new HashMap<String, Object>() {{ put("name", "Biryani"); put("cuisine", "Indian"); }});
        add(new HashMap<String, Object>() {{ put("name", "Butter Paneer and Naan"); put("cuisine", "Indian"); }});
        add(new HashMap<String, Object>() {{ put("name", "Tacos"); put("cuisine", "Mexican"); }});
        add(new HashMap<String, Object>() {{ put("name", "Burrito"); put("cuisine", "Mexican"); }});
        add(new HashMap<String, Object>() {{ put("name", "Nachos"); put("cuisine", "Mexican"); }});
        add(new HashMap<String, Object>() {{ put("name", "Quesadilla"); put("cuisine", "Mexican"); }});
        add(new HashMap<String, Object>() {{ put("name", "Manchurian"); put("cuisine", "Chinese"); }});
        add(new HashMap<String, Object>() {{ put("name", "Paneer Chilly"); put("cuisine", "Chinese"); }});
        add(new HashMap<String, Object>() {{ put("name", "Fried Rice"); put("cuisine", "Chinese"); }});
        add(new HashMap<String, Object>() {{ put("name", "Spring Rolls"); put("cuisine", "Chinese"); }});
        add(new HashMap<String, Object>() {{ put("name", "Noodles"); put("cuisine", "Chinese"); }});
        add(new HashMap<String, Object>() {{ put("name", "Ramen"); put("cuisine", "Chinese"); }});
        add(new HashMap<String, Object>() {{ put("name", "Pizza"); put("cuisine", "Italian"); }});
        add(new HashMap<String, Object>() {{ put("name", "Pasta"); put("cuisine", "Italian"); }});
        add(new HashMap<String, Object>() {{ put("name", "Spaghetti"); put("cuisine", "Italian"); }});
        add(new HashMap<String, Object>() {{ put("name", "Pizza Dosa"); put("cuisine", "South Indian"); }});
        add(new HashMap<String, Object>() {{ put("name", "Masala Dosa"); put("cuisine", "South Indian"); }});
        add(new HashMap<String, Object>() {{ put("name", "Idli Sambhar"); put("cuisine", "South Indian"); }});
        add(new HashMap<String, Object>() {{ put("name", "Thatte Idli"); put("cuisine", "South Indian"); }});
        add(new HashMap<String, Object>() {{ put("name", "Medu Wada"); put("cuisine", "South Indian"); }});
        add(new HashMap<String, Object>() {{ put("name", "Utpam"); put("cuisine", "South Indian"); }});
        add(new HashMap<String, Object>() {{ put("name", "Cold Coffee"); put("cuisine", "Beverages"); }});
        add(new HashMap<String, Object>() {{ put("name", "Cold Drink"); put("cuisine", "Beverages"); }});
        add(new HashMap<String, Object>() {{ put("name", "Energy Drink"); put("cuisine", "Beverages"); }});
        add(new HashMap<String, Object>() {{ put("name", "Juice"); put("cuisine", "Beverages"); }});
        add(new HashMap<String, Object>() {{ put("name", "Lassi"); put("cuisine", "Beverages"); }});
        add(new HashMap<String, Object>() {{ put("name", "Chaas"); put("cuisine", "Beverages"); }});
        add(new HashMap<String, Object>() {{ put("name", "Coffee"); put("cuisine", "Beverages"); }});
        add(new HashMap<String, Object>() {{ put("name", "Soup"); put("cuisine", "Beverages"); }});
        add(new HashMap<String, Object>() {{ put("name", "Burger"); put("cuisine", "American"); }});
        add(new HashMap<String, Object>() {{ put("name", "Sandwich"); put("cuisine", "American"); }});
        add(new HashMap<String, Object>() {{ put("name", "Hot Dog"); put("cuisine", "American"); }});
        add(new HashMap<String, Object>() {{ put("name", "Pancakes"); put("cuisine", "American"); }});
        add(new HashMap<String, Object>() {{ put("name", "French Fries"); put("cuisine", "American"); }});
        add(new HashMap<String, Object>() {{ put("name", "Gulab Jamun"); put("cuisine", "Desserts"); }});
        add(new HashMap<String, Object>() {{ put("name", "Ice Cream"); put("cuisine", "Desserts"); }});
        add(new HashMap<String, Object>() {{ put("name", "Waffle"); put("cuisine", "Desserts"); }});
        add(new HashMap<String, Object>() {{ put("name", "Pie"); put("cuisine", "Desserts"); }});
        add(new HashMap<String, Object>() {{ put("name", "Tiramisu"); put("cuisine", "Desserts"); }});
        add(new HashMap<String, Object>() {{ put("name", "Pastry"); put("cuisine", "Desserts"); }});
        add(new HashMap<String, Object>() {{ put("name", "Chocolate Mousse"); put("cuisine", "Desserts"); }});
    }};


    @Override
    public View onCreateView(LayoutInflater inflater, ViewGroup container, Bundle savedInstanceState) {
        return inflater.inflate(R.layout.fragment_cuisine, container, false);
    }

    @Override
    public void onViewCreated(@NonNull View view, @Nullable Bundle savedInstanceState) {
        super.onViewCreated(view, savedInstanceState);

        db = FirebaseFirestore.getInstance();
        navController = Navigation.findNavController(view);

        if (getArguments() != null) {
            roomId = CuisineFragmentArgs.fromBundle(getArguments()).getRoomId();
            currentUserName = CuisineFragmentArgs.fromBundle(getArguments()).getUserName();
        }

        setupCuisineButton(view.findViewById(R.id.btn_indian), "Indian");
        setupCuisineButton(view.findViewById(R.id.btn_mexican), "Mexican");
        setupCuisineButton(view.findViewById(R.id.btn_chinese), "Chinese");
        setupCuisineButton(view.findViewById(R.id.btn_italian), "Italian");
        setupCuisineButton(view.findViewById(R.id.btn_south_indian), "South Indian");
        setupCuisineButton(view.findViewById(R.id.btn_beverages), "Beverages");
        setupCuisineButton(view.findViewById(R.id.btn_american), "American");
        setupCuisineButton(view.findViewById(R.id.btn_desserts), "Desserts");

        Button submitBtn = view.findViewById(R.id.submit_cuisines_btn);
        submitBtn.setOnClickListener(v -> submitCuisines());

        listenForGameState();
    }

    private void setupCuisineButton(Button button, String cuisineName) {
        button.setOnClickListener(v -> {
            if (selectedCuisines.contains(cuisineName)) {
                selectedCuisines.remove(cuisineName);
                button.setBackgroundColor(ContextCompat.getColor(requireContext(), com.google.android.material.R.color.design_default_color_on_primary));
            } else {
                selectedCuisines.add(cuisineName);
                button.setBackgroundColor(Color.LTGRAY);
            }
        });
    }

    private void submitCuisines() {
        if (selectedCuisines.isEmpty()) {
            Toast.makeText(getContext(), "Please select at least one cuisine.", Toast.LENGTH_SHORT).show();
            return;
        }

        String userId = Objects.requireNonNull(FirebaseAuth.getInstance().getCurrentUser()).getUid();
        db.collection("rooms").document(roomId)
                .update("cuisines." + userId, selectedCuisines)
                .addOnSuccessListener(aVoid -> {
                    if (isAdded() && getView() != null && navController.getCurrentDestination() != null
                            && navController.getCurrentDestination().getId() == R.id.cuisineFragment) {
                        Toast.makeText(getContext(), "Choices submitted! Waiting for others...", Toast.LENGTH_SHORT).show();
                        getView().findViewById(R.id.submit_cuisines_btn).setEnabled(false);
                    }
                })
                .addOnFailureListener(e -> Log.w(TAG, "Error updating cuisines", e));
    }

    private void listenForGameState() {
        if (roomId == null) return;
        roomListener = db.collection("rooms").document(roomId)
                .addSnapshotListener((snapshot, error) -> {
                    if (error != null || snapshot == null || !snapshot.exists()) {
                        return;
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
                        Map<String, Object> cuisinesData = (Map<String, Object>) snapshot.get("cuisines");
                        int submissionCount = cuisinesData != null ? cuisinesData.size() : 0;

                        if (playerCount > 0 && playerCount == submissionCount && "cuisines".equals(snapshot.getString("gameState"))) {
                            generateFoodListAndStartRating(cuisinesData);
                        }
                    }

                    String gameState = snapshot.getString("gameState");
                    if ("rating".equals(gameState)) {
                        if (navController.getCurrentDestination() != null && navController.getCurrentDestination().getId() == R.id.cuisineFragment) {
                            CuisineFragmentDirections.ActionCuisineFragmentToRatingFragment action =
                                    CuisineFragmentDirections.actionCuisineFragmentToRatingFragment(roomId, currentUserName);
                            navController.navigate(action);
                        }
                    }
                });
    }

    private void generateFoodListAndStartRating(Map<String, Object> cuisinesData) {
        Set<String> allSelectedCuisines = new HashSet<>();
        for (Object cuisineListObj : cuisinesData.values()) {
            List<String> cuisineList = (List<String>) cuisineListObj;
            allSelectedCuisines.addAll(cuisineList);
        }

        List<Map<String, Object>> foodListForRating = new ArrayList<>();
        for (Map<String, Object> food : MASTER_FOOD_LIST) {
            if (allSelectedCuisines.contains((String) food.get("cuisine"))) {
                foodListForRating.add(food);
            }
        }
        Collections.shuffle(foodListForRating);

        if(foodListForRating.size() > 15) {
            foodListForRating = foodListForRating.subList(0, 15);
        }

        db.collection("rooms").document(roomId).update(
                "gameState", "rating",
                "foodList", foodListForRating
        );
    }

    @Override
    public void onDestroyView() {
        super.onDestroyView();
        if (roomListener != null) {
            roomListener.remove();
        }
    }
}