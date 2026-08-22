package com.example.hbi.model;

import java.util.HashMap;
import java.util.Map;

public class Player {
    private String name;
    private boolean isHost;
    public Player() {}

    public Player(String name, boolean isHost) {
        this.name = name;
        this.isHost = isHost;
    }

    public String getName() {
        return name;
    }
    public boolean isHost() {
        return isHost;
    }

    public Map<String, Object> toMap() {
        Map<String, Object> map = new HashMap<>();
        map.put("name", name);
        map.put("isHost", isHost);
        return map;
    }
}