package io.hbi.cloud.user;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface UserRepository extends JpaRepository<HbiUser, Long> {

    Optional<HbiUser> findByEmailIgnoreCase(String email);

    boolean existsByEmailIgnoreCase(String email);
}
