package io.hbi.cloud.user;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** Request/response payloads for the user API. */
public final class UserDtos {

    private UserDtos() {
    }

    public record RegisterRequest(
            @NotBlank @Email @Size(max = 160) String email,
            @NotBlank @Size(min = 2, max = 40) String displayName,
            @NotBlank @Size(min = 6, max = 72) String password) {
    }

    public record LoginRequest(
            @NotBlank @Email String email,
            @NotBlank String password) {
    }

    public record UpdateProfileRequest(
            @NotBlank @Size(min = 2, max = 40) String displayName) {
    }

    public record UserView(Long id, String email, String displayName) {
        static UserView of(HbiUser u) {
            return new UserView(u.getId(), u.getEmail(), u.getDisplayName());
        }
    }

    public record LoginResponse(String token, long expiresInSeconds, UserView user) {
    }
}
