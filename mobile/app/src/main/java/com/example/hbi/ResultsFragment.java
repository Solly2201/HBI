package com.example.hbi;

import android.os.Bundle;
import android.util.Log;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.fragment.app.Fragment;
import androidx.navigation.NavController;
import androidx.navigation.Navigation;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

import com.example.hbi.adapter.ResultAdapter;
import com.example.hbi.model.Result; // Corrected from 'models' to 'model'
import com.google.firebase.firestore.FirebaseFirestore;
import com.google.firebase.firestore.ListenerRegistration;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

public class ResultsFragment extends Fragment {

    private static final String TAG = "ResultsFragment";
    private RecyclerView resultsRecyclerView;
    private ResultAdapter resultAdapter;
    private List<Result> resultList = new ArrayList<>();
    private Button playAgainBtn;

    private FirebaseFirestore db;
    private NavController navController;
    private String roomId;
    private ListenerRegistration resultsListener;

    @Override
    public View onCreateView(LayoutInflater inflater, ViewGroup container, Bundle savedInstanceState) {
        return inflater.inflate(R.layout.fragment_results, container, false);
    }

    @Override
    public void onViewCreated(@NonNull View view, @Nullable Bundle savedInstanceState) {
        super.onViewCreated(view, savedInstanceState);

        db = FirebaseFirestore.getInstance();
        navController = Navigation.findNavController(view);
        if (getArguments() != null) {
            roomId = ResultsFragmentArgs.fromBundle(getArguments()).getRoomId();
        }

        resultsRecyclerView = view.findViewById(R.id.results_recycler_view);
        playAgainBtn = view.findViewById(R.id.play_again_btn);

        setupRecyclerView();
        listenForResults();

        playAgainBtn.setOnClickListener(v -> {
            // Navigate back to the home screen
            navController.navigate(R.id.action_resultsFragment_to_homeFragment);
        });
    }

    private void setupRecyclerView() {
        resultAdapter = new ResultAdapter(resultList);
        resultsRecyclerView.setLayoutManager(new LinearLayoutManager(getContext()));
        resultsRecyclerView.setAdapter(resultAdapter);
    }

    private void listenForResults() {
        if (roomId == null) return;
        resultsListener = db.collection("rooms").document(roomId)
                .addSnapshotListener((snapshot, error) -> {
                    if (error != null || snapshot == null || !snapshot.exists()) {
                        Log.w(TAG, "Listen failed.", error);
                        return;
                    }

                    // Fetch finalResults from the Firestore room document
                    if (snapshot.contains("finalResults")) {
                        List<Map<String, Object>> resultsData = (List<Map<String, Object>>) snapshot.get("finalResults");
                        resultList.clear();
                        if (resultsData != null) {
                            for (Map<String, Object> resultData : resultsData) {
                                Result result = new Result((String) resultData.get("name"), (String) resultData.get("cuisine"));
                                resultList.add(result);
                            }
                        }
                        // Populate the resultList and notify the adapter
                        resultAdapter.notifyDataSetChanged();
                    }
                });
    }

    @Override
    public void onDestroyView() {
        super.onDestroyView();
        // Stop listening for updates to prevent memory leaks
        if (resultsListener != null) {
            resultsListener.remove();
        }
    }
}