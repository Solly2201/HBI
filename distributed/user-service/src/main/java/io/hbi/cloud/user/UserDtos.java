package io.hbi.cloud.user;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** Request/response payloads for the user API. */
public final class UserDtos {

    private UserDtos() {
    }

    /** All an anonymous player provides is the name the room will see. */
    public record SessionRequest(
            @NotBlank @Size(min = 1, max = 40) String displayName) {
    }

    public record UpdateProfileRequest(
            @NotBlank @Size(min = 2, max = 40) String displayName) {
    }

    public record UserView(Long id, String displayName) {
        static UserView of(HbiUser u) {
            return new UserView(u.getId(), u.getDisplayName());
        }
    }

    public record SessionResponse(String token, long expiresInSeconds, UserView user) {
    }
}
