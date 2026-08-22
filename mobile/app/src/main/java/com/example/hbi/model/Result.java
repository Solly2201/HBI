package com.example.hbi.model;

public class Result {
    private String name;
    private String cuisine;
    // Add other fields like rank or score if needed

    public Result() {} // Required for Firestore

    public Result(String name, String cuisine) {
        this.name = name;
        this.cuisine = cuisine;
    }

    public String getName() {
        return name;
    }

    public String getCuisine() {
        return cuisine;
    }
}