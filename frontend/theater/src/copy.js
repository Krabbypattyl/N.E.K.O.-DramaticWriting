export const COPY = {
  appName: "N.E.K.O.-DramaticWriting",
  appSubline: "N.E.K.O Numeric v2",
  stages: {
    setup: { label: "项目总览", hint: "创作想法与故事设定" },
    story: { label: "故事地图", hint: "节点、数值、路线与结局" },
    publish: { label: "检查交付", hint: "编译、复验与安装" },
  },
  status: {
    setup: "未生成",
    generating: "生成中",
    editing: "编辑中",
    invalid: "存在问题",
    compiled: "已编译",
    verified: "可发布",
  },
};

export function statusLabel(status) {
  return COPY.status[status] || "编辑中";
}

export function issueMessage(error) {
  const code = error?.code || "request_failed";
  const issues = Array.isArray(error?.details?.issues) ? error.details.issues : [];
  if (code === "invalid_mainline_generation" && issues.length) {
    const attempts = Number(error?.details?.attempts || 3);
    const reasons = issues.slice(0, 3).map((item) => `${item.message || item.code}（${item.path || "未知位置"}）`);
    const remaining = issues.length > reasons.length ? `；另有 ${issues.length - reasons.length} 项` : "";
    return `已自动尝试 ${attempts} 次，仍有 ${issues.length} 项未通过：${reasons.join("；")}${remaining}。已保存有效内容，可继续生成剩余结构。`;
  }
  const messages = {
    project_revision_conflict: "项目已在别处更新，本地草稿没有被覆盖。",
    generation_setup_invalid: "请先填写标题、创作想法和目标篇幅。",
    mainline_generation_input_too_short: "创作想法需要超过 30 个字，才能生成剧情结构。",
    invalid_mainline_generation: "AI 返回的主线或结局结构仍不完整，已保存可继续使用的部分。",
    invalid_length_preset: "目标篇幅无效，请重新选择后再生成。",
    invalid_model_json: "模型没有返回有效 JSON，本次没有修改原内容。",
    node_enhancement_input_required: "请先填写节点标题和剧情摘要。",
    node_enhancement_type_unsupported: "只有幕节点和结局节点可以使用 AI 完善。",
    invalid_node_enhancement: "AI 返回的节点完善结构不符合要求，本次没有修改原内容。",
    invalid_fact_review: "事实检查未返回可核对的完整依据，本次未保存新报告。",
    invalid_quality_assessment: "AI 没有返回完整的六维评分和逐节点修改方案，本次没有修改故事。",
    quality_assessment_required: "请先点击评分并查看修改方案。",
    quality_assessment_stale: "故事在评分后已经修改，请重新评分后再接受方案。",
    quality_node_not_repairable: "该节点没有可自动执行的修改建议，请重新评分或手动调整。",
    // 范围校验失败不会保存候选，提示作者区分旧报告、空修改和超出已展示方案的修改。
    // 证据复核失败有独立阶段，不能显示文学分或保存半份报告。
    // 方案复核失败时保留上次完整报告，不把已返回的文学分当成本次成功。
    invalid_repair_plan_review: "方案复核未返回完整有效的结论，本次未保存新报告。",
    invalid_fact_evidence_review: "证据复核结果不完整或字段不符，请重新评分。",
    quality_reassessment_required: "此报告缺少当前证据、字段与方案复核，请重新评分后再优化。",
    quality_repair_no_change: "本次没有产生实际修改，原故事已保留。",
    quality_repair_outside_plan: "候选修改超出了已展示方案的字段范围，未保存，请重新评分或手动调整。",
    quality_issue_stale: "方案关联的节点已经变化，请重新评分。",
    invalid_quality_repair: "定向修复没有严格遵守已接受的节点范围，本次没有修改故事。",
    branch_source_not_found: "没有找到支线来源节点。",
    branch_source_terminal: "结局节点不能继续生成支线。",
    branch_source_single_exit_required: "支线创作功能目前只支持恰好一条出路的节点。",
    branch_source_unconditional_exit_required: "该节点已经有路线条件，请使用高级路线编辑。",
    branch_metric_required: "请先配置至少一个带有剧情含义区间的隐藏数值。",
    mainline_order_required: "当前项目还没有可靠的主线顺序，请先确认哪几幕属于主线。",
    mainline_order_invalid: "当前主线顺序与故事地图不一致，请重新确认。",
    branch_rejoin_target_invalid: "这个主线回接点已经不可用，请重新选择。",
    branch_continuity_exceeds_three_scenes: "需要承接的主线事实超过三幕容量，请选择更近的回接点。",
    branch_context_too_large: "当前内容超过该模型可安全生成的范围，请选择更近的终点或缩短相关描述。",
    branch_length_too_short: "当前回接点需要更长的支线才能承接关键事实。",
    branch_condition_required: "请选择支线触发状态，或让生成模型推荐。",
    branch_condition_unknown: "触发状态已经变化，请重新选择。",
    branch_condition_unreachable: "按所有可达前序入口估算，这个状态超过 8 回合仍无法达到，请选择其他状态或调整路线。",
    branch_pacing_entry_unknown: "存在无法可靠确认的前序路线，请先调整循环或缺失节点。",
    branch_pacing_no_entry: "没有找到能够到达该来源幕的前序路线。",
    branch_pacing_all_unreachable: "所有可达前序路线都超过 8 回合，暂时不能生成这条数值支线。",
    branch_pacing_partial_reachability: "只有部分前序路线能在 8 回合内达到，生成后可能继承前序选择影响。",
    branch_natural_exit_player_action_missing: "该支线幕缺少玩家可亲自执行的离幕动作，可能在现场反复停留。",
    branch_natural_exit_player_action_not_actionable: "该支线幕的离幕说明没有留下可提交的玩家动作，请不要只写观察或等待。",
    branch_expected_turns_exceed_8: "该支线幕预计超过 8 回合，建议压缩事件链或补充更明确的离幕动作。",
    branch_expected_turns_unknown: "该支线幕没有可靠的预计回合数，建议作者补充估算后再判断节奏。",
    branch_expected_turns_exceed_40: "该支线幕预计超过 40 回合，建议拆幕或删减事件链后再生成。",
    scene_natural_exit_player_action_missing: "该主线幕缺少玩家可亲自执行的离幕动作，可能在现场反复停留。",
    scene_natural_exit_player_action_not_actionable: "该主线幕的离幕说明没有留下可提交的玩家动作，请不要只写观察或等待。",
    scene_expected_turns_exceed_8: "该主线幕预计超过 8 回合，建议压缩事件链。",
    scene_expected_turns_unknown: "该主线幕没有可靠的预计回合数，建议作者补充估算后再判断节奏。",
    scene_expected_turns_exceed_40: "该主线幕预计超过 40 回合，建议拆幕或删减事件链后再生成。",
    v2_2_turn_limit_out_of_range: "v2.2 要求每个数值方向的单回合变化上限为 1—5。",
    branch_direction_required: "请先描述这条支线想发生什么。",
    branch_ending_direction_required: "请先描述这个结局最后变成什么样。",
    branch_ending_draft_required: "请先生成并确认结局草稿。",
    invalid_branch_ending: "AI 返回的结局草稿不完整，本次没有修改故事地图。",
    invalid_branch_generation: "AI 返回的支线草稿不完整，本次没有修改故事地图。",
    branch_scene_count_mismatch: "AI 返回的支线幕数与作者选择不一致。",
    branch_transition_count_mismatch: "AI 返回的支线过渡数量不完整。",
    branch_transition_chain_invalid: "AI 返回的支线过程没有按固定终点连续推进。",
    branch_continuity_incomplete: "AI 没有完整承接被绕过的主线事实。",
    branch_draft_stale: "故事在草稿生成后已经变化，请重新生成支线。",
    branch_draft_not_ready: "支线草稿尚未完成，不能应用。",
    branch_source_changed: "支线来源已经变化，请重新生成。",
    branch_endpoint_changed: "支线终点已经变化，请重新生成。",
    numeric_v2_compile_failed: "剧本存在确定性合同问题，请按路径修改。",
    current_compile_required: "当前内容需要重新检查。",
    current_neko_validation_required: "请先使用 N.E.K.O 复验当前版本。",
    model_auth_failed: "模型鉴权失败，请检查 API Key。",
    model_timeout: "模型请求超时，本次没有自动重试。",
    numeric_v2_story_exists: "N.E.K.O 中已存在相同 story ID，未执行覆盖。",
  };
  const message = messages[code] || `操作失败：${code}`;
  // 评分阶段由后端明确返回；普通生成/修订错误仍走原有文案。
  if (error?.details?.phase === "facts") return `本次评分未完成：事实核对失败，文学评分尚未开始。${message}`;
  if (error?.details?.phase === "evidence") return `本次评分未完成：证据复核失败，文学评分尚未开始，未保存新报告。${message}`;
  if (error?.details?.phase === "literature") return `本次评分未完成：事实已核对，文学评分失败，未保存新报告。${message}`;
  if (error?.details?.phase === "plan_review") return `本次评分未完成：方案复核失败，未保存新报告。${message}`;
  return message;
}
