/*
 * Standalone Gradle project for the KrishiChain Android app.
 *
 * Deliberately NOT an npm workspace member — this directory lives under apps/android/ purely
 * because that's where the other app surfaces (apps/gateway, apps/web) live, but nothing here
 * touches the root package.json or npm workspaces.
 */
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "krishichain-android"
include(":app")
