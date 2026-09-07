package dev.codetui.englishsyntax.language

import dev.codetui.englishsyntax.contract.FixtureLoader
import dev.codetui.englishsyntax.domain.SentenceInput
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ValidatorMessagesTest {
  private val fixture = Json.parseToJsonElement(FixtureLoader.text("validator-messages.json")).jsonObject

  @Test
  fun `fixture schema is versioned and unambiguous`() {
    val cases = fixture.getValue("cases").jsonArray
    val ids = cases.map { it.jsonObject.getValue("id").jsonPrimitive.content }

    assertEquals(1, fixture.getValue("schemaVersion").jsonPrimitive.content.toInt())
    assertTrue(cases.isNotEmpty())
    assertEquals(ids.size, ids.toSet().size)
    assertTrue(cases.all {
      val testCase = it.jsonObject
      val accepted = testCase.getValue("accepted").jsonPrimitive.content.toBooleanStrict()
      val expected = testCase.getValue("expected").jsonArray
      if (accepted) expected.isEmpty() else expected.isNotEmpty()
    })
  }

  @Test
  fun `Kotlin validator matches every complete ordered TypeScript error list`() {
    fixture.getValue("cases").jsonArray.forEach { element ->
      val testCase = element.jsonObject
      assertEquals(expectedErrors(testCase), actualErrors(testCase), "fixture case ${testCase.id()}")
    }
  }

  @Test
  fun `covered message substrings are closed over fixture errors`() {
    val substrings = fixture.getValue("coveredMessageSubstrings").jsonArray.map { it.jsonPrimitive.content }
    val messages = fixture.getValue("cases").jsonArray
      .flatMap { actualErrors(it.jsonObject) }
      .map { it.message }

    assertEquals(
      emptyList(),
      substrings.filter { substring -> messages.none { it.contains(substring) } },
      "every declared substring must be represented by an actual fixture error",
    )
    assertEquals(
      emptyList(),
      messages.filter { message -> substrings.none { message.contains(it) } },
      "every actual fixture error must belong to a declared covered message family",
    )
  }

  private fun actualErrors(testCase: JsonObject) = run {
    val sentenceJson = testCase.getValue("sentence").jsonObject
    val text = sentenceJson.getValue("text").jsonPrimitive.content
    val sentence = SentenceInput(
      sentenceId = sentenceJson.getValue("id").jsonPrimitive.content,
      text = text,
      tokens = tokenize(text),
    )
    val result = validateCoreBatch(testCase.getValue("raw"), listOf(sentence), "validator-messages-fixture")
    val accepted = testCase.getValue("accepted").jsonPrimitive.content.toBooleanStrict()

    assertEquals(accepted, result.ok, "fixture case ${testCase.id()} acceptance")
    result.errors
  }

  private fun expectedErrors(testCase: JsonObject) = testCase.getValue("expected").jsonArray.map { element ->
    val expected = element.jsonObject
    expected.getValue("path").jsonPrimitive.content to expected.getValue("message").jsonPrimitive.content
  }

  private fun JsonObject.id() = getValue("id").jsonPrimitive.content

  private fun List<dev.codetui.englishsyntax.domain.ValidationError>.asPairs() = map { it.path to it.message }

  private fun assertEquals(
    expected: List<Pair<String, String>>,
    actual: List<dev.codetui.englishsyntax.domain.ValidationError>,
    message: String,
  ) = assertEquals(expected, actual.asPairs(), message)
}
