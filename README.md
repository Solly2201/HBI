# Hungry but Indecisive?

"Hungry but Indecisive?" (HBI) is a real-time, multiplayer web application designed to solve the age-old problem of friends not being able to decide what to eat. Users create or join a room, select their preferred cuisines, rate a series of food items, and the application compiles everyone's ratings to present the group's top food matches.

-----

## Features

  * **Real-Time Multiplayer Rooms**: Create a private room and invite friends with a unique 5-character ID.
  * **Host Controls**: The room creator acts as the host and controls when the game starts.
  * **Dynamic Player List**: See who has joined the room in real-time, including disconnect and reconnect statuses.
  * **Collaborative Cuisine Selection**: All players select their preferred cuisines to generate a pool of potential food items.
  * **Host Force-Blend**: The host can advance the game to the rating stage based on early submissions, without waiting for every player.
  * **Interactive Rating System**: Rate food items on the "EAT-O-METER" slider to score them from 1 to 5.
  * **Compiled Group Results**: The application calculates the average score for each food item and presents the group's top 5 matches.
  * **Shared Food List**: Players can add the final results to a globally synchronized list, so everyone knows the final choices.
  * **Session Persistence**: Refreshing the page will automatically reconnect you to your room and restore the game to its current state.

-----

## How It Works

1.  **Create or Join**: A user enters their name and either creates a new room (becoming the host) or joins an existing one with an ID.
2.  **Wait for Players**: In the waiting screen, the host waits for at least one other player to join before starting the "Blend".
3.  **Select Cuisines**: Each player is presented with a list of cuisines and selects their preferences. Players can submit their choices individually.
4.  **Rate Food**: Based on a combined pool of the group's cuisine choices, a series of food items are shown to all players. Each player rates the items privately.
5.  **See Results**: The application compiles all the ratings and displays the top 5 food matches with the highest average scores for the group.
6.  **Build Your List**: Players can add items from the results to a final, shared list to finalize their decision.

-----

## Tech Stack

  * **Backend**: Node.js, Express.js
  * **Real-Time Communication**: Socket.IO
  * **Frontend**: HTML5, CSS3, Vanilla JavaScript

-----

## Setup and Installation

To run this project locally, follow these steps:

1.  Clone the repository to your local machine:
    ```bash
    git clone <your-repository-url>
    ```
2.  Navigate into the project directory:
    ```bash
    cd <project-directory>
    ```
3.  Install the necessary dependencies:
    ```bash
    npm install
    ```
4.  Start the server:
    ```bash
    node server.js
    ```
5.  Open your web browser and go to `http://localhost:3000`.
