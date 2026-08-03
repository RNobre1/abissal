# frozen_string_literal: true

require 'spec_helper'
require 'scraper/reconciliation_job'

# Lição B56 (03/08): a fase de reconciliação precisa ser executável FORA do
# orchestrator — quando a coleta morre por timeout (02-03/08: dois dias), a
# cauda morre junto e o fim de semana inteiro fica sem actuals. Este job é a
# unidade que tanto o orchestrator quanto o bin/run_reconcilers (job de
# resgate do workflow) invocam.
RSpec.describe AdamStats::Scraper::ReconciliationJob do
  let(:logs) { [] }
  let(:logger) { ->(m) { logs << m } }

  let(:pred_stats) { { resolved: 3, pending: 1, unresolvable: 0 } }
  let(:sim_stats)  { { resolved: 5, pending: 2, unresolvable: 1 } }
  let(:reco_stats) { { resolved: 2, pending: 0, unresolvable: 0 } }

  def stub_reconciler(klass, stats)
    instance = instance_double(klass, run: stats)
    allow(klass).to receive(:new).and_return(instance)
    instance
  end

  it 'roda os 3 reconcilers na ordem do orchestrator e devolve as stats de cada um' do
    stub_reconciler(AdamStats::Scraper::PredictionReconciler, pred_stats)
    stub_reconciler(AdamStats::Scraper::SimulationReconciler, sim_stats)
    stub_reconciler(AdamStats::Scraper::AiRecommendationReconciler, reco_stats)

    result = described_class.new(logger: logger).run

    expect(result['PredictionReconciler']).to eq(pred_stats)
    expect(result['SimulationReconciler']).to eq(sim_stats)
    expect(result['AiRecommendationReconciler']).to eq(reco_stats)
  end

  it 'isolamento: um reconciler quebrando NÃO impede os seguintes (semântica do orchestrator)' do
    stub_reconciler(AdamStats::Scraper::PredictionReconciler, pred_stats)
    boom = instance_double(AdamStats::Scraper::SimulationReconciler)
    allow(boom).to receive(:run).and_raise(StandardError, 'db caiu')
    allow(AdamStats::Scraper::SimulationReconciler).to receive(:new).and_return(boom)
    stub_reconciler(AdamStats::Scraper::AiRecommendationReconciler, reco_stats)

    result = described_class.new(logger: logger).run

    expect(result['PredictionReconciler']).to eq(pred_stats)
    expect(result['SimulationReconciler']).to be_nil
    expect(result['AiRecommendationReconciler']).to eq(reco_stats)
    expect(logs.join("\n")).to include('db caiu')
  end

  it 'propaga o logger para os reconcilers' do
    [AdamStats::Scraper::PredictionReconciler,
     AdamStats::Scraper::SimulationReconciler,
     AdamStats::Scraper::AiRecommendationReconciler].each do |klass|
      instance = instance_double(klass, run: {})
      expect(klass).to receive(:new).with(logger: logger).and_return(instance)
    end

    described_class.new(logger: logger).run
  end
end
