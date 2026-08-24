package io.hbi.cloud.user;

import io.hbi.cloud.user.UserDtos.LoginRequest;
import io.hbi.cloud.user.UserDtos.LoginResponse;
import io.hbi.cloud.user.UserDtos.RegisterRequest;
import io.hbi.cloud.user.UserDtos.UpdateProfileRequest;
import io.hbi.cloud.user.UserDtos.UserView;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
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
    private final PasswordEncoder encoder = new BCryptPasswordEncoder();

    public UserController(UserRepository users, JwtIssuer jwt) {
        this.users = users;
        this.jwt = jwt;
    }

    @PostMapping("/register")
    public ResponseEntity<UserView> register(@Valid @RequestBody RegisterRequest req) {
        String email = req.email().trim().toLowerCase();
        if (users.existsByEmailIgnoreCase(email)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "That email is already registered.");
        }
        HbiUser saved = users.save(new HbiUser(email, req.displayName().trim(), encoder.encode(req.password())));
        return ResponseEntity.status(HttpStatus.CREATED).body(UserView.of(saved));
    }

    @PostMapping("/login")
    public LoginResponse login(@Valid @RequestBody LoginRequest req) {
        HbiUser user = users.findByEmailIgnoreCase(req.email().trim())
                .filter(u -> encoder.matches(req.password(), u.getPasswordHash()))
                // Same message for "no such user" and "wrong password" so the
                // endpoint cannot be used to enumerate registered emails.
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid email or password."));
        return new LoginResponse(jwt.issue(user), jwt.ttlSeconds(), UserView.of(user));
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
