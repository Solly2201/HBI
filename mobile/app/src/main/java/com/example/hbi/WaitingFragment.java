package com.example.hbi;

import android.os.Bundle;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.TextView;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.fragment.app.Fragment;
import androidx.navigation.NavController;
import androidx.navigation.Navigation;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;
import com.example.hbi.adapter.PlayerAdapter;
import com.example.hbi.model.Player;
import com.google.firebase.firestore.FirebaseFirestore;
import com.google.firebase.firestore.ListenerRegistration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;

public class WaitingFragment extends Fragment {

    private TextView roomIdDisplay, playerCount;
    private RecyclerView playersRecyclerView;
    private Button startBlendBtn;
    private PlayerAdapter playerAdapter;
    private List<Player> playerList = new ArrayList<>();
    private FirebaseFirestore db;
    private String roomId;
    private String currentUserName;
    private ListenerRegistration roomListener;

    @Override
    public View onCreateView(LayoutInflater inflater, ViewGroup container, Bundle savedInstanceState) {
        return inflater.inflate(R.layout.fragment_waiting, container, false);
    }

    @Override
    public void onViewCreated(@NonNull View view, @Nullable Bundle savedInstanceState) {
        super.onViewCreated(view, savedInstanceState);

        db = FirebaseFirestore.getInstance();
        if (getArguments() != null) {
            roomId = WaitingFragmentArgs.fromBundle(getArguments()).getRoomId();
            currentUserName = WaitingFragmentArgs.fromBundle(getArguments()).getUserName();
        }

        roomIdDisplay = view.findViewById(R.id.room_id_display);
        playerCount = view.findViewById(R.id.player_count);
        startBlendBtn = view.findViewById(R.id.start_blend_btn);
        playersRecyclerView = view.findViewById(R.id.players_recycler_view);

        roomIdDisplay.setText(roomId);
        setupRecyclerView();
        listenForRoomUpdates();

        startBlendBtn.setOnClickListener(v -> {
            db.collection("rooms").document(roomId).update("gameState", "cuisines");
        });
    }

    private void setupRecyclerView() {
        playerAdapter = new PlayerAdapter(playerList);
        playersRecyclerView.setLayoutManager(new LinearLayoutManager(getContext()));
        playersRecyclerView.setAdapter(playerAdapter);
    }

    private void listenForRoomUpdates() {

        if (roomId == null) return;
        roomListener = db.collection("rooms").document(roomId)
                .addSnapshotListener((snapshot, e) -> {
                    if (e != null || snapshot == null || !snapshot.exists()) {
                        return;
                    }

                    List<Map<String, Object>> playersData = (List<Map<String, Object>>) snapshot.get("players");
                    playerList.clear();
                    boolean isCurrentUserHost = false;

                    if (playersData != null) {
                        for (Map<String, Object> playerData : playersData) {
                            Player player = new Player((String) playerData.get("name"), (Boolean) playerData.get("isHost"));
                            playerList.add(player);
                            if (Objects.equals(player.getName(), currentUserName) && player.isHost()) {
                                isCurrentUserHost = true;
                            }
                        }
                    }
                    playerAdapter.notifyDataSetChanged();
                    playerCount.setText("Joined (" + playerList.size() + "/8)");

                    if (isCurrentUserHost && playerList.size() >= 1) {
                        startBlendBtn.setVisibility(View.VISIBLE);
                    } else {
                        startBlendBtn.setVisibility(View.GONE);
                    }

                    String gameState = snapshot.getString("gameState");
                    if ("cuisines".equals(gameState)) {
                        NavController navController = Navigation.findNavController(requireActivity(), R.id.nav_host_fragment);
                        if (navController.getCurrentDestination() != null && navController.getCurrentDestination().getId() == R.id.waitingFragment) {
                            WaitingFragmentDirections.ActionWaitingFragmentToCuisineFragment action =
                                    WaitingFragmentDirections.actionWaitingFragmentToCuisineFragment(roomId, currentUserName);
                            navController.navigate(action);
                        }
                    }
                });
    }

    @Override
    public void onDestroyView() {
        super.onDestroyView();
        if (roomListener != null) {
            roomListener.remove();
        }
    }

}