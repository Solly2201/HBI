package com.example.hbi;

import android.os.Bundle;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.TextView;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.fragment.app.Fragment;
import androidx.navigation.NavController;
import androidx.navigation.Navigation;
import com.example.hbi.model.Player;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.firestore.FieldValue;
import com.google.firebase.firestore.FirebaseFirestore;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;
import java.util.Random;

public class HomeFragment extends Fragment {

    private EditText yourNameInput, roomIdInput;
    private TextView errorMessage;
    private FirebaseFirestore db;
    private NavController navController;

    @Override
    public View onCreateView(LayoutInflater inflater, ViewGroup container, Bundle savedInstanceState) {
        return inflater.inflate(R.layout.fragment_home, container, false);
    }

    @Override
    public void onViewCreated(@NonNull View view, @Nullable Bundle savedInstanceState) {
        super.onViewCreated(view, savedInstanceState);

        db = FirebaseFirestore.getInstance();
        navController = Navigation.findNavController(view);

        yourNameInput = view.findViewById(R.id.your_name_input);
        roomIdInput = view.findViewById(R.id.room_id_input);
        errorMessage = view.findViewById(R.id.error_message);
        Button createNewBtn = view.findViewById(R.id.create_new_btn);
        Button joinRoomBtn = view.findViewById(R.id.join_room_btn);

        createNewBtn.setOnClickListener(v -> createRoom());
        joinRoomBtn.setOnClickListener(v -> joinRoom());
    }

    private void createRoom() {
        String name = yourNameInput.getText().toString().trim();
        if (name.isEmpty()) {
            errorMessage.setText("Please enter your name.");
            return;
        }

        if (FirebaseAuth.getInstance().getCurrentUser() == null) {
            errorMessage.setText("Authentication failed. Please restart the app.");
            return;
        }

        String roomId = generateRoomId();
        Player host = new Player(name, true);

        Map<String, Object> roomData = new HashMap<>();
        roomData.put("gameState", "waiting");
        roomData.put("players", Collections.singletonList(host.toMap()));

        db.collection("rooms").document(roomId).set(roomData)
                .addOnSuccessListener(aVoid -> navigateToWaitingRoom(roomId, name))
                .addOnFailureListener(e -> errorMessage.setText("Failed to create room."));
    }

    private void joinRoom() {
        String name = yourNameInput.getText().toString().trim();
        String roomId = roomIdInput.getText().toString().trim().toUpperCase();
        if (name.isEmpty() || roomId.isEmpty()) {
            errorMessage.setText("Please enter your name and Room ID.");
            return;
        }

        Player newPlayer = new Player(name, false);
        db.collection("rooms").document(roomId).update("players", FieldValue.arrayUnion(newPlayer.toMap()))
                .addOnSuccessListener(aVoid -> navigateToWaitingRoom(roomId, name))
                .addOnFailureListener(e -> errorMessage.setText("Room not found or failed to join."));
    }

    private void navigateToWaitingRoom(String roomId, String userName) {
        HomeFragmentDirections.ActionHomeFragmentToWaitingFragment action =
                HomeFragmentDirections.actionHomeFragmentToWaitingFragment(roomId, userName);
        navController.navigate(action);
    }

    private String generateRoomId() {
        String chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
        StringBuilder builder = new StringBuilder();
        Random rnd = new Random();
        while (builder.length() < 5) {
            int index = (int) (rnd.nextFloat() * chars.length());
            builder.append(chars.charAt(index));
        }
        return builder.toString();
    }
}