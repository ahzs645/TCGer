package com.ahmadjalil.tcger.features.social

/** Integration entry point kept independent from the application's shared ViewModel. */
object SocialFeatureFactory {
    fun createController(
        serverUrl: String?,
        authToken: String?,
        currentUserId: String?,
    ): SocialFeatureController {
        val repository = if (serverUrl.isNullOrBlank() || authToken.isNullOrBlank()) {
            null
        } else {
            RemoteSocialRepository.create(serverUrl, authToken)
        }
        return SocialFeatureController(repository, currentUserId)
    }
}
