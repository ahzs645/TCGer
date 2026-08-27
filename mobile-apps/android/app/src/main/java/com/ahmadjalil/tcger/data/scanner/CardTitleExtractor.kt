package com.ahmadjalil.tcger.data.scanner

object CardTitleExtractor {
    private val noise = Regex(
        "^(basic|stage [0-9i]+|trainer|supporter|item|stadium|energy|pokemon|pokémon|" +
            "creature|instant|sorcery|enchantment|artifact|land|legendary|spell card|trap card|" +
            "hp ?[0-9]+|[0-9]+ ?hp|set|illustration rare|common|uncommon|rare)$",
        RegexOption.IGNORE_CASE,
    )
    private val stats = Regex("(^|\\s)(hp|atk|def|level|weakness|resistance|retreat|illus)($|[: .0-9])", RegexOption.IGNORE_CASE)

    fun candidateQueries(recognizedText: String): List<String> = recognizedText
        .lineSequence()
        .map { it.trim().replace(Regex("\\s+"), " ") }
        .filter { it.length in 3..60 }
        .filterNot { noise.matches(it) || stats.containsMatchIn(it) }
        .filter { line ->
            val letters = line.count(Char::isLetter)
            letters >= 3 && letters.toDouble() / line.length >= 0.55
        }
        .map { it.trim('•', '·', '-', '|', ':') }
        .filter { it.length >= 3 }
        .distinctBy(String::lowercase)
        .take(6)
        .toList()
}
