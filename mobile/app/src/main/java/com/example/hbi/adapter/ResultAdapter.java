package com.example.hbi.adapter;

import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;
import androidx.annotation.NonNull;
import androidx.recyclerview.widget.RecyclerView;
import com.example.hbi.R;
import com.example.hbi.model.Result;
import java.util.List;

public class ResultAdapter extends RecyclerView.Adapter<ResultAdapter.ResultViewHolder> {

    private List<Result> resultList;

    public ResultAdapter(List<Result> resultList) {
        this.resultList = resultList;
    }

    @NonNull
    @Override
    public ResultViewHolder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
        View view = LayoutInflater.from(parent.getContext()).inflate(R.layout.list_item_result, parent, false);
        return new ResultViewHolder(view);
    }

    @Override
    public void onBindViewHolder(@NonNull ResultViewHolder holder, int position) {
        Result result = resultList.get(position);
        holder.rank.setText("#" + (position + 1));
        holder.itemName.setText(result.getName());
        holder.cuisineName.setText(result.getCuisine());
    }

    @Override
    public int getItemCount() {
        return resultList.size();
    }

    public static class ResultViewHolder extends RecyclerView.ViewHolder {
        TextView rank, itemName, cuisineName;
        public ResultViewHolder(@NonNull View itemView) {
            super(itemView);
            rank = itemView.findViewById(R.id.result_rank);
            itemName = itemView.findViewById(R.id.result_item_name);
            cuisineName = itemView.findViewById(R.id.result_cuisine);
        }
    }
}