package dev.codetui.englishsyntax.contract

import dev.codetui.englishsyntax.domain.SentenceInput
import dev.codetui.englishsyntax.language.tokenize
import dev.codetui.englishsyntax.language.validateCoreBatch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlin.test.Test
import kotlin.test.assertTrue

class CoreGoldAnnotationsTest {
  @Test
  fun `every shared gold annotation passes the production validator`() {
    val fixture = Json.parseToJsonElement(FixtureLoader.text("core-gold-annotations.json")).jsonObject

    for (sentenceElement in fixture.getValue("sentences").jsonArray) {
      val sentence = sentenceElement.jsonObject
      val sentenceId = sentence.getValue("id").jsonPrimitive.content
      val text = sentence.getValue("text").jsonPrimitive.content
      val request = SentenceInput(sentenceId, text, tokenize(text))
      val raw = buildJsonObject {
        put("sentences", buildJsonArray {
          add(buildJsonObject {
            put("sentenceId", sentenceId)
            put("components", buildJsonArray {
              for (componentElement in sentence.getValue("components").jsonArray) {
                val component = componentElement.jsonObject
                add(buildJsonObject {
                  put("startToken", component.getValue("startToken").jsonPrimitive.content.toInt())
                  put("endToken", component.getValue("endToken").jsonPrimitive.content.toInt())
                  put("role", component.getValue("role").jsonPrimitive.content)
                  put("translation", "译文")
                })
              }
            })
          })
        })
      }

      val result = validateCoreBatch(raw, listOf(request), "gold")
      assertTrue(result.ok, "$sentenceId: $text; ${result.errors}")
    }
  }
}
