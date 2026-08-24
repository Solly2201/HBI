package io.hbi.cloud.user;

import io.hbi.cloud.user.UserDtos.SessionRequest;
import io.hbi.cloud.user.UserDtos.SessionResponse;
import io.hbi.cloud.user.UserDtos.UpdateProfileRequest;
import io.hbi.cloud.user.UserDtos.UserView;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/users")
public class UserController {

    private final UserRepository users;
    private final JwtIssuer jwt;

    public UserController(UserRepository users, JwtIssuer jwt) {
        this.users = users;
        this.jwt = jwt;
    }

    /**
     * The only way into HBI: a display name in, a signed session token out.
     *
     * HBI is a party game, so there are no accounts, no passwords and no
     * login. Each session is a real user row with a real JWT — the gateway
     * and the other services authenticate it like any bearer token — but the
     * identity is anonymous and lives only as long as players keep the token.
     */
    @PostMapping("/session")
    public SessionResponse session(@Valid @RequestBody SessionRequest req) {
        HbiUser saved = users.save(new HbiUser(req.displayName().trim()));
        return new SessionResponse(jwt.issue(saved), jwt.ttlSeconds(), UserView.of(saved));
    }

    @GetMapping("/{id}")
    public UserView get(@PathVariable Long id) {
        return users.findById(id)
                .map(UserView::of)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "User not found."));
    }

    @PutMapping("/{id}")
    public UserView update(@PathVariable Long id,
                           @RequestHeader(value = "X-User-Id", required = false) Long callerId,
                           @Valid @RequestBody UpdateProfileRequest req) {
        // X-User-Id is stamped by the API Gateway from the verified JWT.
        if (callerId == null || !callerId.equals(id)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "You can only update your own profile.");
        }
        HbiUser user = users.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "User not found."));
        user.setDisplayName(req.displayName().trim());
        return UserView.of(users.save(user));
    }
}
