# ---- build stage -------------------------------------------------------
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /build

# Dependencies are resolved first so that source-only edits reuse this layer.
COPY pom.xml .
RUN mvn -B -DskipTests dependency:go-offline

COPY src ./src
RUN mvn -B -DskipTests clean package

# ---- runtime stage -----------------------------------------------------
FROM eclipse-temurin:21-jre-alpine
WORKDIR /app

RUN addgroup -S hbi && adduser -S hbi -G hbi
COPY --from=build /build/target/*.jar app.jar
USER hbi

EXPOSE 8081
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75", "-jar", "/app/app.jar"]
